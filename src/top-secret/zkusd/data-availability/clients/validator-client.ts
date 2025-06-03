import { ValidatorDAInterface } from '../../interfaces/da-interface.js';
import {
  IntentProof,
  IntentProofHelper,
  JsonIntentProof,
} from '../../types/intent-proof.js';
import { NextStateCandidate, StateRoots } from '../../validator/block-state.js';
import { LocalStateProxy } from '../../validator/local-block-state.js';
import {
  BlockBlob,
  BlobType,
  CheckpointBlob,
  BlockData,
} from '../types/types.js';
import { BlockBlobBuilder } from '../services/block-blob-builder.js';
import { CheckpointBlobBuilder } from '../services/checkpoint-blob-builder.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
import { StorageProvider } from '../providers/storage-provider.js';
import {
  ProviderFactory,
  WalrusOptions,
  LocalOptions,
  ProviderType,
} from '../providers/provider-factory.js';
import { StateSyncService } from '../services/state-sync.js';
import { Field } from 'o1js';
import { StateStoreMetadata } from '../../interfaces/sequencer-interface.js';

export interface ValidatorDAClientConfig {
  storageProvider: StorageProvider;
  walrusOptions?: WalrusOptions;
  localOptions?: LocalOptions;
  checkpointInterval?: number;
}

export class ValidatorDAClient implements ValidatorDAInterface {
  storageProvider: StorageProvider;
  private readonly syncService: StateSyncService;
  private readonly blockBlobBuilder: BlockBlobBuilder;
  private readonly checkpointInterval: number;

  constructor(config: ValidatorDAClientConfig) {
    // Use the factory to create the appropriate provider
    this.storageProvider = config.storageProvider;
    this.blockBlobBuilder = new BlockBlobBuilder();
    this.checkpointInterval = config.checkpointInterval ?? 500;
    this.syncService = new StateSyncService(this.storageProvider);
  }

  // Convenience constructor methods for easier usage
  static async withWalrus(
    options?: WalrusOptions & { checkpointInterval?: number }
  ): Promise<ValidatorDAClient> {
    const { checkpointInterval, ...walrusOptions } = options || {};
    return new ValidatorDAClient({
      storageProvider: await ProviderFactory.createProvider(
        'walrus',
        walrusOptions
      ),
      checkpointInterval,
    });
  }

  static async withLocal(
    options?: LocalOptions & { checkpointInterval?: number }
  ): Promise<ValidatorDAClient> {
    const { checkpointInterval, ...localOptions } = options || {};
    return new ValidatorDAClient({
      storageProvider: await ProviderFactory.createProvider(
        'local',
        localOptions
      ),
      checkpointInterval,
    });
  }

  async initDA(genesisStateRoots: StateRoots): Promise<StateStoreMetadata> {
    // 1. Get the initial state from the local proxy
    const initialStateRoots = genesisStateRoots;

    // 2. Create the genesis block file
    const genesisBlockBlob = BlockBlobBuilder.buildGenesisBlockBlob({
      initialStateRoots,
    });

    // 3. Store the genesis block file
    const genesisBlockBlobId = await this.storageProvider.store(
      JSON.stringify(genesisBlockBlob),
      {
        blobType: BlobType.BLOCK,
      }
    );

    // 6. Return the blob IDs
    return {
      blockBlobId: genesisBlockBlobId,
    };
  }

  async fetchIntentProof(intentBlobId: string): Promise<IntentProof> {
    try {
      const rawData = await this.storageProvider.retrieve(intentBlobId);
      const jsonIntentProof = JSON.parse(rawData) as JsonIntentProof;
      const intentProof: IntentProof =
        await IntentProofHelper.fromJSON(jsonIntentProof);
      return intentProof;
    } catch (error) {
      throw new Error(
        `Failed to fetch intent proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async syncViaBlockBlob(args: {
    localStateProxy: LocalStateProxy;
    blockBlobId: string;
  }): Promise<void> {
    await this.syncService.syncToBlockBlobState(
      args.localStateProxy,
      args.blockBlobId
    );
  }

  async publishBlockUpdate(
    localStateProxy: LocalStateProxy,
    nextStateCandidate: NextStateCandidate
  ): Promise<StateStoreMetadata> {
    const previousBlockStateCommitment =
      await localStateProxy.getStateCommitment();

    // 1. Retrieve the previous block file
    const previousBlockRawData = await this.storageProvider.retrieve(
      previousBlockStateCommitment.stateBlobHandle,
      {
        blobType: BlobType.BLOCK,
      }
    );

    const previousBlockBlob = JSON.parse(previousBlockRawData) as BlockBlob;
    const currentBlock = previousBlockBlob.blockData.block + 1;

    // 2. Check if we need to create a checkpoint (after checkpoint interval)
    let checkpointBlobId: string | undefined;
    const shouldCreateCheckpoint = this.shouldCreateCheckpoint(currentBlock);

    if (shouldCreateCheckpoint) {
      console.log(
        'Creating checkpoint for block:',
        previousBlockBlob.blockData.block
      );
      checkpointBlobId = await this.createCheckpoint(
        localStateProxy, // The checkpoint represents the state at the previous block
        previousBlockBlob
      );

      console.log('Checkpoint Blob ID:', checkpointBlobId);
    }

    if (checkpointBlobId) {
      console.log(
        'Adding new checkpoint blob id to block metadata:',
        checkpointBlobId
      );
    }

    // 3. Build the new block file
    const newBlockFile = BlockBlobBuilder.buildBlockBlob({
      previousBlockBlob,
      previousStateRoots: previousBlockStateCommitment.stateRoots,
      previousBlockBlobId: previousBlockStateCommitment.stateBlobHandle,
      nextStateValidatedIntentOperations: nextStateCandidate.intentOperations,
      nextStateRoots: nextStateCandidate.nextBlockStateRoots,
      checkpointBlobId,
      checkpointBlock: checkpointBlobId
        ? previousBlockBlob.blockData.block
        : undefined,
    });

    // 3. Store the new block file
    const newBlockBlobId = await this.storageProvider.store(
      JSON.stringify(newBlockFile),
      {
        blobType: BlobType.BLOCK,
      }
    );

    return {
      blockBlobId: newBlockBlobId,
      checkpointBlobId,
    };
  }

  /**
   * Determines if a checkpoint should be created for the given block
   */
  private shouldCreateCheckpoint(block: number): boolean {
    return block > 0 && block % this.checkpointInterval === 0;
  }

  /**
   * Creates a checkpoint using the local state proxy
   */
  private async createCheckpoint(
    localStateProxy: LocalStateProxy,
    blockBlob: BlockBlob
  ): Promise<string> {
    let previousCheckpointBlob: CheckpointBlob | undefined;
    let previousCheckpointBlobId: string =
      blockBlob.blockMetadata.checkpointBlobId;

    if (previousCheckpointBlobId) {
      // 1. Retrieve the previous checkpoint blob
      const previousCheckpointBlobRawData = await this.storageProvider.retrieve(
        previousCheckpointBlobId,
        {
          blobType: BlobType.CHECKPOINT,
        }
      );

      previousCheckpointBlob = JSON.parse(
        previousCheckpointBlobRawData
      ) as CheckpointBlob;
    }

    // 2. Collect the checkpoint block history
    const checkpointBlockHistory =
      await this.collectCheckpointBlockHistory(blockBlob);

    // Get the current state from the local proxy (this represents block - 1 state)
    const currentState = await localStateProxy.useState();

    // Build the checkpoint file using the current state maps
    const checkpointBlob = CheckpointBlobBuilder.buildCheckpointBlob({
      vaultMap: currentState.vaultMap,
      zkUsdMap: currentState.zkUsdMap,
      checkpointBlock: blockBlob.blockData.block,
      checkpointBlockHistory,
      previousCheckpointBlob: previousCheckpointBlob ?? undefined,
    });

    // Store the checkpoint file
    const checkpointBlobId = await this.storageProvider.store(
      JSON.stringify(checkpointBlob),
      {
        blobType: BlobType.CHECKPOINT,
      }
    );

    return checkpointBlobId;
  }

  private async collectCheckpointBlockHistory(
    blockBlob: BlockBlob
  ): Promise<BlockData[]> {
    const checkpointBlockHistoryData: BlockData[] = [];

    const blobsToCollect = blockBlob.blockMetadata.sinceCheckpointBlockHeaders;

    for (const blockHeader of blobsToCollect) {
      const blockBlobRawData = await this.storageProvider.retrieve(
        blockHeader.blockBlobId,
        {
          blobType: BlobType.BLOCK,
        }
      );

      const blockBlob = JSON.parse(blockBlobRawData) as BlockBlob;
      checkpointBlockHistoryData.push(blockBlob.blockData);
    }

    // Add the current block data
    checkpointBlockHistoryData.push(blockBlob.blockData);

    return checkpointBlockHistoryData;
  }

  // Utility methods for testing and debugging
  getProviderInfo(): any {
    if ('getStorageInfo' in this.storageProvider) {
      return (this.storageProvider as any).getStorageInfo();
    }
    return { type: 'unknown' };
  }
}
