import { LocalStateProxy } from '../../validator/local-block-state.js';
import { StorageProvider } from '../providers/storage-provider.js';
import {
  BlockBlob,
  CheckpointBlob,
  BlobType,
  Operation,
  BlockMetadata,
  BlockData,
} from '../types/types.js';
import {
  StateRoots,
  FullState,
  stateRootsEqual,
} from '../../validator/block-state.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
import { VaultMap } from '../../data/maps/vault-map.js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { Bool, Field, UInt64, UInt8 } from 'o1js';
import { StateCommitment } from '../../validator/sequencer-interface.js';

export class StateSyncService {
  constructor(private storageProvider: StorageProvider) {}

  /**
   * Syncs local state to match the target metadata state
   */
  async syncToBlockBlobState(
    localStateProxy: LocalStateProxy,
    blockBlobHandle: string
  ): Promise<void> {
    // 1. Fetch block blob
    const blockBlob = await this.fetchBlockBlob(blockBlobHandle);

    // 2. Get current local state
    const currentLocalRoots = await localStateProxy.stateRoots();

    const blockRoots: StateRoots = {
      vaultMapRoot: Field(blockBlob.blockData.vaultMapRoot),
      zkUsdMapRoot: Field(blockBlob.blockData.zkUsdMapRoot),
    };

    const isAlreadySynced = stateRootsEqual(currentLocalRoots, blockRoots);

    // 3. Check if already synced

    if (isAlreadySynced) {
      console.log('Local state is already synced');
      return;
    }

    // 4. Determine sync strategy
    const syncStrategy = await this.determineSyncStrategy(
      currentLocalRoots,
      blockBlob.blockMetadata
    );

    // 5. Execute sync strategy
    await this.executeSyncStrategy(
      localStateProxy,
      syncStrategy,
      blockBlob.blockData,
      blockBlobHandle
    );
  }

  private async fetchBlockBlob(blockBlobHandle: string): Promise<BlockBlob> {
    const rawData = await this.storageProvider.retrieve(blockBlobHandle, {
      blobType: BlobType.BLOCK,
    });
    return JSON.parse(rawData) as BlockBlob;
  }

  /**
   * The sync strategy is determined based on the following criteria:
   * 1. If we are unable to find our local roots in any of the blocks in the metadata then we perform a sync from the checkpoint
   * 2. If there is no checkpoint then we perform a full sync from all the blocks
   * 3. If we are able to find our local roots in the metadata then we perform a partial incremental sync from the block we found our local roots at
   */
  private async determineSyncStrategy(
    currentLocalRoots: StateRoots,
    blockMetadata: BlockMetadata
  ): Promise<SyncStrategy> {
    //Check which block our local state is at

    console.log('Determining sync strategy');

    const localStateBlock = this.identifyLocalStateBlock(
      currentLocalRoots,
      blockMetadata
    );

    if (localStateBlock === 0) {
      console.log('Unable to find local state block, using checkpoint');
      //We were unable to find the block that our local state is at, fully resync the state

      if (blockMetadata.checkpointBlobId) {
        return {
          type: 'checkpoint-incremental',
          checkpointBlobId: blockMetadata.checkpointBlobId,
          incrementalBlockBlobIds: this.getIncrementalBlockIds(
            blockMetadata.checkpointBlock,
            blockMetadata
          ),
        };
      } else {
        //We don't have a checkpoint, so we need to do a full sync
        console.log('No checkpoint, doing full sync');
        return {
          type: 'full-incremental',
          blockBlobIds: this.getAllBlockIds(blockMetadata),
        };
      }
    }

    console.log('Found local state block, doing partial sync');

    // We found our local state in the metadata history
    // Just sync incrementally from where we left off
    return {
      type: 'partial-incremental',
      fromBlock: localStateBlock,
      blockBlobIds: this.getIncrementalBlockIds(localStateBlock, blockMetadata),
    };
  }

  private getAllBlockIds(blockMetadata: BlockMetadata): string[] {
    return blockMetadata.sinceCheckpointBlockHeaders
      .sort((a, b) => a.block - b.block) // Ensure chronological order
      .map((block) => block.blockBlobId);
  }

  private identifyLocalStateBlock(
    currentLocalRoots: StateRoots,
    blockMetadata: BlockMetadata
  ): number {
    const matchingBlock = blockMetadata.sinceCheckpointBlockHeaders.find(
      (block) => {
        const blockRoots = {
          vaultMapRoot: Field(block.vaultMapRoot),
          zkUsdMapRoot: Field(block.zkUsdMapRoot),
        };
        return stateRootsEqual(currentLocalRoots, blockRoots);
      }
    );

    console.log('Matching Block:', matchingBlock?.block);

    if (!matchingBlock) {
      //We were unable to find the block that our local state is at, fully resync the state
      return 0;
    }

    return matchingBlock.block;
  }

  private blobToIntentOperations(
    blobOperations: Operation[]
  ): IntentMapOperation[] {
    return blobOperations.map(
      (operation) =>
        new IntentMapOperation(
          operation.mapType,
          operation.type,
          Field(operation.key),
          Field(operation.value)
        )
    );
  }

  private async fetchCheckpoint(
    checkpointBlobId: string
  ): Promise<CheckpointBlob> {
    const rawData = await this.storageProvider.retrieve(checkpointBlobId, {
      blobType: BlobType.CHECKPOINT,
    });
    return JSON.parse(rawData) as CheckpointBlob;
  }

  private getIncrementalBlockIds(
    fromBlock: number,
    blockMetadata: BlockMetadata
  ): string[] {
    const blockIds: string[] = [];
    const blockHistory = blockMetadata.sinceCheckpointBlockHeaders;

    if (blockHistory.length === 0) return [];

    const currentBlock = blockHistory[blockHistory.length - 1].block;

    // Get block blob IDs from fromBlock + 1 to current block
    for (let block = fromBlock + 1; block <= currentBlock; block++) {
      const blockHistoryItem = blockHistory.find(
        (blockHistoryItem) => blockHistoryItem.block === block
      );
      if (blockHistoryItem) {
        blockIds.push(blockHistoryItem.blockBlobId);
      } else {
        throw new Error(`Block ${block} not found in metadata`);
      }
    }

    return blockIds;
  }

  private async executeSyncStrategy(
    localStateProxy: LocalStateProxy,
    strategy: SyncStrategy,
    blockData: BlockData,
    blockBlobHandle: string
  ): Promise<void> {
    switch (strategy.type) {
      case 'checkpoint-incremental':
        await this.executeCheckpointIncrementalSync(
          localStateProxy,
          strategy,
          blockData,
          blockBlobHandle
        );
        break;
      case 'partial-incremental':
        await this.executeIncrementalSync(
          localStateProxy,
          strategy,
          blockData,
          blockBlobHandle
        );
        break;
      case 'full-incremental':
        await this.executeIncrementalSync(
          localStateProxy,
          strategy,
          blockData,
          blockBlobHandle
        );
        break;
    }
  }

  private async executeIncrementalSync(
    localStateProxy: LocalStateProxy,
    strategy: FullIncrementalStrategy | PartialIncrementalStrategy,
    blockData: BlockData,
    blockBlobHandle: string
  ): Promise<void> {
    console.log('Executing incremental sync');
    console.log(strategy);

    // Apply operations from all block files sequentially
    for (const blockBlobId of strategy.blockBlobIds) {
      const blockBlob = await this.fetchBlockBlob(blockBlobId);
      if (blockBlob.blockData.operations.length > 0) {
        await localStateProxy.applyIntentOperations({
          finalizedBlockOperations: this.blobToIntentOperations(
            blockBlob.blockData.operations
          ),
          finalizedStateStoreMetadata: {
            blockBlobId: blockBlobId,
          },
        });
      }
    }

    // Apply latest block operations
    await localStateProxy.applyIntentOperations({
      finalizedBlockOperations: this.blobToIntentOperations(
        blockData.operations
      ),
      finalizedStateStoreMetadata: {
        blockBlobId: blockBlobHandle,
      },
    });
  }

  private async executeCheckpointIncrementalSync(
    localStateProxy: LocalStateProxy,
    strategy: CheckpointIncrementalStrategy,
    blockData: BlockData,
    blockBlobHandle: string
  ): Promise<void> {
    console.log('Executing checkpoint incremental sync');
    console.log(strategy);

    // 1. Load state from checkpoint
    const checkpointData = await this.fetchCheckpoint(
      strategy.checkpointBlobId
    );
    const restoredState = this.restoreStateFromCheckpoint(checkpointData);

    const lastBlockBlobId = strategy.incrementalBlockBlobIds.at(-1);
    if (!lastBlockBlobId) {
      throw new Error('No incremental block blob IDs found');
    }
    await localStateProxy.setState({
      finalizedState: restoredState,
      finalizedStateStoreMetadata: {
        blockBlobId: blockBlobHandle,
      },
    });

    // 2. Apply incremental operations
    for (const blockBlobId of strategy.incrementalBlockBlobIds) {
      const blockBlob = await this.fetchBlockBlob(blockBlobId);
      if (blockBlob.blockData.operations.length > 0) {
        await localStateProxy.applyIntentOperations({
          finalizedBlockOperations: this.blobToIntentOperations(
            blockBlob.blockData.operations
          ),
          finalizedStateStoreMetadata: {
            blockBlobId: blockBlobId,
          },
        });
      }
    }

    // 3. Apply current block operations
    await localStateProxy.applyIntentOperations({
      finalizedBlockOperations: this.blobToIntentOperations(
        blockData.operations
      ),
      finalizedStateStoreMetadata: {
        blockBlobId: blockBlobHandle,
      },
    });
  }

  private restoreStateFromCheckpoint(
    checkpointData: CheckpointBlob
  ): FullState {
    // Restore maps from serialized data
    const vaultMap = VaultMap.fromSerialized(checkpointData.vaultMapData);
    const zkUsdMap = ZkUsdMap.fromSerialized(checkpointData.zkUsdMapData);

    // Create FullState with default system params (would need to be stored/retrieved)
    return new FullState(
      this.getDefaultSystemParams(), // Would need proper system params
      vaultMap,
      zkUsdMap
    );
  }

  private getDefaultSystemParams() {
    // This should be retrieved from somewhere or passed as parameter
    // For now, return a placeholder
    return {
      validPriceBlockCount: UInt8.from(10),
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(150),
      liquidationBonusRatio: UInt8.from(100),
      vaultDebtCeiling: UInt64.from(1_000_000e9),
      oraclesHash: Field.from(0),
    };
  }
}

// Strategy types
type SyncStrategy =
  | CheckpointIncrementalStrategy
  | PartialIncrementalStrategy
  | FullIncrementalStrategy;

interface CheckpointIncrementalStrategy {
  type: 'checkpoint-incremental';
  checkpointBlobId: string;
  incrementalBlockBlobIds: string[];
}

interface PartialIncrementalStrategy {
  type: 'partial-incremental';
  fromBlock: number;
  blockBlobIds: string[];
}

interface FullIncrementalStrategy {
  type: 'full-incremental';
  blockBlobIds: string[];
}
