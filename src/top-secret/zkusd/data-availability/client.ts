import {
  DataAvailBlobIds,
  DataAvailInterface,
} from '../validator/data-avail-interface.js';
import { IntentProof } from '../types/intent-proof.js';
import {
  FullState,
  NextBlockStateCandidate,
  StateRoots,
} from '../validator/block-state.js';
import { LocalStateProxy } from '../validator/local-block-state.js';
import { BlockFile, FileType, MetadataFile } from './types/types.js';
import { BlockFileBuilder } from './services/block-file-builder.js';
import { MetadataFileBuilder } from './services/metadata-file-builder.js';
import { CheckpointFileBuilder } from './services/checkpoint-file-builder.js';
import { SequencerStateMetadata } from '../validator/sequencer-interface.js';
import { IntentMapOperation } from '../validator/map-operation.js';
import { StorageProvider } from './providers/storage-provider.js';
import {
  ProviderFactory,
  ProviderConfig,
  ProviderType,
} from './providers/provider-factory.js';
import { StateSyncService } from './services/state-sync.js';

export interface DataAvailClientConfig {
  provider: ProviderConfig;
  checkpointInterval?: number;
}

export class DataAvailClient implements DataAvailInterface {
  storageProvider: StorageProvider;
  private readonly syncService: StateSyncService;
  private readonly blockFileBuilder: BlockFileBuilder;
  private readonly checkpointInterval: number;

  constructor(config: DataAvailClientConfig) {
    this.storageProvider = ProviderFactory.createProvider(config.provider);
    this.blockFileBuilder = new BlockFileBuilder();
    this.checkpointInterval = config.checkpointInterval ?? 500;
    this.syncService = new StateSyncService(this.storageProvider);
  }

  // Convenience constructor methods for easier usage
  static withWalrus(options?: {
    defaultBlocks?: number;
    defaultAddress?: string;
    checkpointInterval?: number;
  }): DataAvailClient {
    return new DataAvailClient({
      provider: {
        type: 'walrus',
        walrus: {
          defaultBlocks: options?.defaultBlocks,
          defaultAddress: options?.defaultAddress,
        },
      },
      checkpointInterval: options?.checkpointInterval,
    });
  }

  static withLocal(options?: {
    baseDir?: string;
    checkpointInterval?: number;
  }): DataAvailClient {
    return new DataAvailClient({
      provider: {
        type: 'local',
        local: {
          baseDir: options?.baseDir,
        },
      },
      checkpointInterval: options?.checkpointInterval,
    });
  }

  async initDA(localStateProxy: LocalStateProxy): Promise<DataAvailBlobIds> {
    // 1. Get the initial state from the local proxy
    const initialState = await localStateProxy.useState();
    const initialStateRoots = await localStateProxy.stateRoots();

    // 2. Create the genesis block file
    const genesisBlockFile = BlockFileBuilder.buildGenesisBlockFile({
      initialStateRoots,
    });

    // 3. Store the genesis block file
    const genesisBlockBlobId = await this.storageProvider.store(
      JSON.stringify(genesisBlockFile),
      {
        fileType: FileType.EPOCH,
      }
    );

    // 4. Create the genesis metadata file
    const genesisMetadataFile = MetadataFileBuilder.buildGenesisMetadataFile({
      genesisBlockFile,
      genesisBlockBlobId,
    });

    // 5. Store the genesis metadata file
    const genesisMetadataBlobId = await this.storageProvider.store(
      JSON.stringify(genesisMetadataFile),
      {
        fileType: FileType.METADATA,
      }
    );

    // 6. Return the blob IDs
    return {
      blockBlobId: genesisBlockBlobId,
      metadataBlobId: genesisMetadataBlobId,
    };
  }

  async fetchIntentProof(intentBlobHandle: string): Promise<IntentProof> {
    try {
      const rawData = await this.storageProvider.retrieve(intentBlobHandle);
      const intentProof = JSON.parse(rawData) as IntentProof;
      return intentProof;
    } catch (error) {
      throw new Error(
        `Failed to fetch intent proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async syncLocalState(
    localStateProxy: LocalStateProxy,
    targetMetadataBlobHandle: string
  ): Promise<void> {
    return this.syncService.syncLocalState(
      localStateProxy,
      targetMetadataBlobHandle
    );
  }

  async publishBlockUpdate(
    finalizedStateMetadata: SequencerStateMetadata,
    nextStateValidatedIntentOperations: IntentMapOperation[],
    nextStateRoots: StateRoots,
    localStateProxy: LocalStateProxy
  ): Promise<DataAvailBlobIds> {
    // 1. Retrieve the previous block file
    const previousBlockRawData = await this.storageProvider.retrieve(
      finalizedStateMetadata.stateBlobHandle,
      {
        fileType: FileType.EPOCH,
      }
    );

    const previousBlockFile = JSON.parse(previousBlockRawData) as BlockFile;
    const currentBlock = previousBlockFile.block + 1;

    // 2. Build the new block file
    const newBlockFile = BlockFileBuilder.buildBlockFile({
      previousBlockFile,
      previousStateRoots: finalizedStateMetadata.stateRoots,
      previousBlockBlobId: finalizedStateMetadata.stateBlobHandle,
      nextStateValidatedIntentOperations,
      nextStateRoots,
    });

    // 3. Store the new block file
    const newBlockBlobId = await this.storageProvider.store(
      JSON.stringify(newBlockFile),
      {
        fileType: FileType.EPOCH,
      }
    );

    // 4. Check if we need to create a checkpoint (after checkpoint interval)
    let checkpointBlobId: string | undefined;
    const shouldCreateCheckpoint = this.shouldCreateCheckpoint(currentBlock);

    if (shouldCreateCheckpoint) {
      checkpointBlobId = await this.createCheckpoint(
        localStateProxy,
        previousBlockFile.block, // The checkpoint represents the state at the previous block
        finalizedStateMetadata.stateBlobHandle
      );
    }

    // 5. Retrieve the metadata file
    const metadataRawData = await this.storageProvider.retrieve(
      finalizedStateMetadata.metadataBlobHandle,
      {
        fileType: FileType.METADATA,
      }
    );
    const previousMetadataFile = JSON.parse(metadataRawData) as MetadataFile;

    let checkpointBlock: number | undefined;

    if (checkpointBlobId) checkpointBlock = previousBlockFile.block;

    // 6. Build the metadata file (with optional checkpoint reference)
    const newMetadataFile = MetadataFileBuilder.buildMetadataFile({
      previousMetadataFile,
      newBlockFile,
      newBlockBlobId,
      checkpointBlobId, // Will be included if checkpoint was created
      checkpointBlock,
    });

    // 7. Store the metadata file
    const newMetadataBlobId = await this.storageProvider.store(
      JSON.stringify(newMetadataFile),
      {
        fileType: FileType.METADATA,
      }
    );

    return {
      blockBlobId: newBlockBlobId,
      metadataBlobId: newMetadataBlobId,
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
    block: number,
    blockBlobId: string
  ): Promise<string> {
    // Get the current state from the local proxy (this represents block - 1 state)
    const currentState = await localStateProxy.useState();

    // Generate checkpoint ID
    const checkpointId = `checkpoint-block-${block}-${Date.now()}`;

    // Build the checkpoint file using the current state maps
    const checkpointFile = CheckpointFileBuilder.buildCheckpointFile({
      vaultMap: currentState.vaultMap,
      zkUsdMap: currentState.zkUsdMap,
      block: block,
      checkpointId,
      blockBlobId,
    });

    // Store the checkpoint file
    const checkpointBlobId = await this.storageProvider.store(
      JSON.stringify(checkpointFile),
      {
        fileType: FileType.CHECKPOINT,
      }
    );

    return checkpointBlobId;
  }

  // Utility methods for testing and debugging
  getProviderInfo(): any {
    if ('getStorageInfo' in this.storageProvider) {
      return (this.storageProvider as any).getStorageInfo();
    }
    return { type: 'unknown' };
  }
}
