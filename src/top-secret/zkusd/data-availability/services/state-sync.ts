import { LocalStateProxy } from '../../validator/local-block-state.js';
import { StorageProvider } from '../providers/storage-provider.js';
import {
  MetadataFile,
  BlockFile,
  CheckpointFile,
  FileType,
  Operation,
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
  async syncToMetadataFileState(
    localStateProxy: LocalStateProxy,
    metadataBlobId: string,
  ): Promise<void> {
    // 1. Fetch target metadata
    const metadata = await this.fetchMetadata(
      metadataBlobId
    );

    // 2. Get current local state
    const currentLocalRoots = await localStateProxy.stateRoots();

    const metadataRoots: StateRoots = {
      vaultMapRoot: Field(metadata.latestVaultMapRoot),
      zkUsdMapRoot: Field(metadata.latestZkUsdMapRoot),
    };

    const isAlreadySynced = stateRootsEqual(currentLocalRoots, metadataRoots);

    // 3. Check if already synced
    if (isAlreadySynced) return;

    // 4. Determine sync strategy
    const syncStrategy = await this.determineSyncStrategy(
      currentLocalRoots,
      metadata,
      metadataBlobId
    );

    // 5. Execute sync strategy
    await this.executeSyncStrategy(localStateProxy, syncStrategy);
  }

  private async fetchMetadata(
    metadataBlobId: string
  ): Promise<MetadataFile> {
    const rawData = await this.storageProvider.retrieve(metadataBlobId, {
      fileType: FileType.METADATA,
    });
    return JSON.parse(rawData) as MetadataFile;
  }

  /**
   * The sync strategy is determined based on the following criteria:
   * 1. If we are unable to find our local roots in any of the blocks in the metadata then we perform a sync from the checkpoint
   * 2. If there is no checkpoint then we perform a full sync from all the blocks
   * 3. If we are able to find our local roots in the metadata then we perform a partial incremental sync from the block we found our local roots at
   */
  private async determineSyncStrategy(
    currentLocalRoots: StateRoots,
    metadata: MetadataFile,
    metadataBlobId: string,
  ): Promise<SyncStrategy> {
    //Check which block our local state is at
    const localStateBlock = this.identifyLocalStateBlock(
      currentLocalRoots,
      metadata
    );

    if (localStateBlock === 0) {
      //We were unable to find the block that our local state is at, fully resync the state

      if (metadata.latestCheckpointFileBlobId) {
        return {
          type: 'checkpoint-incremental',
          checkpointBlobId: metadata.latestCheckpointFileBlobId,
          incrementalBlockBlobIds: this.getIncrementalBlockIds(
            metadata.latestCheckpointBlock,
            metadata
          ),
          metadataBlobId: metadataBlobId,
        };
      } else {
        //We don't have a checkpoint, so we need to do a full sync
        return {
          type: 'full-incremental',
          blockBlobIds: this.getAllBlockIds(metadata),
          metadataBlobId: metadataBlobId,
        };
      }
    }

    // We found our local state in the metadata history
    // Just sync incrementally from where we left off
    return {
      type: 'partial-incremental',
      fromBlock: localStateBlock,
      blockBlobIds: this.getIncrementalBlockIds(localStateBlock, metadata),
      metadataBlobId: metadataBlobId,
    };
  }

  private getAllBlockIds(metadata: MetadataFile): string[] {
    return metadata.blocks
      .sort((a, b) => a.block - b.block) // Ensure chronological order
      .map((block) => block.blockBlobId);
  }

  private identifyLocalStateBlock(
    currentLocalRoots: StateRoots,
    metadata: MetadataFile
  ): number {
    const blockMetadata = metadata.blocks.find((block) => {
      const blockRoots = {
        vaultMapRoot: Field(block.vaultMapRoot),
        zkUsdMapRoot: Field(block.zkUsdMapRoot),
      };
      return stateRootsEqual(currentLocalRoots, blockRoots);
    });

    if (!blockMetadata) {
      //We were unable to find the block that our local state is at, fully resync the state
      return 0;
    }

    return blockMetadata.block;
  }

  private fileToIntentOperations(
    fileOperations: Operation[]
  ): IntentMapOperation[] {
    return fileOperations.map(
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
  ): Promise<CheckpointFile> {
    const rawData = await this.storageProvider.retrieve(checkpointBlobId, {
      fileType: FileType.CHECKPOINT,
    });
    return JSON.parse(rawData) as CheckpointFile;
  }

  private getIncrementalBlockIds(
    fromBlock: number,
    metadata: MetadataFile
  ): string[] {
    const blockIds: string[] = [];

    // Get block blob IDs from fromBlock + 1 to current block
    for (let block = fromBlock + 1; block <= metadata.latestBlock; block++) {
      const blockMetadata = metadata.blocks.find(
        (blockMetadata) => blockMetadata.block === block
      );
      if (blockMetadata) {
        blockIds.push(blockMetadata.blockBlobId);
      } else {
        throw new Error(`Block ${block} not found in metadata`);
      }
    }

    return blockIds;
  }

  private async executeSyncStrategy(
    localStateProxy: LocalStateProxy,
    strategy: SyncStrategy
  ): Promise<void> {
    switch (strategy.type) {
      case 'checkpoint-incremental':
        await this.executeCheckpointIncrementalSync(localStateProxy, strategy);
        break;
      case 'partial-incremental':
      case 'full-incremental':
        await this.executeIncrementalSync(localStateProxy, strategy);
        break;
    }
  }

  private async executeIncrementalSync(
    localStateProxy: LocalStateProxy,
    strategy: PartialIncrementalStrategy | FullIncrementalStrategy
  ): Promise<void> {
    // Apply operations from the specified block files sequentially
    for (const blockBlobId of strategy.blockBlobIds) {
      const blockFile = await this.fetchBlockFile(blockBlobId);
      if (blockFile.operations.length > 0) {
        await localStateProxy.applyIntentOperations({
      finalizedBlockOperations: this.fileToIntentOperations(blockFile.operations),
      finalizedStateStoreMetadata: {
        metadataBlobId: strategy.metadataBlobId,
        blockBlobId: blockBlobId,
      }
        }
        );
      }
    }
  }

  private async executeCheckpointIncrementalSync(
    localStateProxy: LocalStateProxy,
    strategy: CheckpointIncrementalStrategy
  ): Promise<void> {
    // assert that there are incremental blob ids
    // otherwise localStateProxy does not have a correct one set.
    if(strategy.incrementalBlockBlobIds.length === 0) {
      throw new Error('No incremental block blob IDs found');
    }

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
        metadataBlobId: strategy.metadataBlobId,
        blockBlobId: 'checkpoint',
      },
    });

    // 2. Apply incremental operations
    for (const blockBlobId of strategy.incrementalBlockBlobIds) {
      const blockFile = await this.fetchBlockFile(blockBlobId);
      if (blockFile.operations.length > 0) {
        await localStateProxy.applyIntentOperations({
          finalizedBlockOperations: this.fileToIntentOperations(blockFile.operations),
          finalizedStateStoreMetadata: {
            metadataBlobId: strategy.metadataBlobId,
            blockBlobId: blockBlobId,
          },
        });
      }
    }
  }

  private async fetchBlockFile(blockBlobId: string): Promise<BlockFile> {
    const rawData = await this.storageProvider.retrieve(blockBlobId, {
      fileType: FileType.EPOCH,
    });
    return JSON.parse(rawData) as BlockFile;
  }

  private restoreStateFromCheckpoint(
    checkpointData: CheckpointFile
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
  metadataBlobId: string;
}

interface PartialIncrementalStrategy {
  type: 'partial-incremental';
  fromBlock: number;
  blockBlobIds: string[];
  metadataBlobId: string;
}

interface FullIncrementalStrategy {
  type: 'full-incremental';
  blockBlobIds: string[];
  metadataBlobId: string;
}
