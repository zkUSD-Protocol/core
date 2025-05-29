import {
  DataAvailBlobIds,
  DataAvailInterface,
} from '../validator/data-avail-interface.js';
import { WalrusProvider } from './providers/walrus-provider.js';
import { IntentProof } from '../types/intent-proof.js';
import {
  FullState,
  NextEpochStateCandidate,
} from '../validator/epoch-state.js';
import { FinalizedState } from '../validator/local-epoch-state.js';
import { EpochFile, MetadataFile } from './types/types.js';
import { EpochFileBuilder } from './services/epoch-file-builder.js';
import { MetadataFileBuilder } from './services/metadata-file-builder.js';

export class DataAvailClient implements DataAvailInterface {
  private readonly storageProvider: WalrusProvider;
  private readonly epochFileBuilder: EpochFileBuilder;

  constructor(walrusOptions?: {
    defaultEpochs?: number;
    defaultAddress?: string;
  }) {
    this.storageProvider = new WalrusProvider(walrusOptions);
    this.epochFileBuilder = new EpochFileBuilder();
  }

  async fetchIntentProof(intentBlobHandle: string): Promise<IntentProof> {
    try {
      const rawData = await this.storageProvider.retrieve(intentBlobHandle);

      // Parse and validate the intent proof
      // Do we want to validate the intent proof here?
      const intentProof = JSON.parse(rawData) as IntentProof;

      return intentProof;
    } catch (error) {
      throw new Error(
        `Failed to fetch intent proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  fetchFullEpochState(epochBlobHandle: string): Promise<FullState> {
    throw new Error('Not implemented');
  }

  updateLocalFinalizedState(
    epochBlobHandle: string,
    finalizedState: FinalizedState
  ): Promise<void> {
    throw new Error('Not implemented');
  }

  async publishEpochUpdate(
    previousEpochBlobId: string,
    metadataBlobId: string,
    computedEpochState: NextEpochStateCandidate,
    finalizedState: FinalizedState
  ): Promise<DataAvailBlobIds> {
    // 1. Retrieve the previous epoch file
    const previousEpochRawData =
      await this.storageProvider.retrieve(previousEpochBlobId);

    const previousEpochFile = JSON.parse(previousEpochRawData) as EpochFile;

    // 2. Build the new epoch file
    const newEpochFile = EpochFileBuilder.buildEpochFile({
      previousEpochFile,
      epochState: computedEpochState,
      previousEpochBlobId,
    });

    // 3. Store the new epoch file
    const newEpochBlobId = await this.storageProvider.store(
      JSON.stringify(newEpochFile)
    );

    // 4. Retrieve the metadata file
    const metadataRawData = await this.storageProvider.retrieve(metadataBlobId);
    const previousMetadataFile = JSON.parse(metadataRawData) as MetadataFile;

    // 5. Build the metadata file
    const newMetadataFile = MetadataFileBuilder.buildMetadataFile({
      previousMetadataFile,
      newEpochFile,
      newEpochBlobId,
      epochState: computedEpochState,
    });

    // 6. Store the metadata file - we s
    const newMetadataBlobId = await this.storageProvider.store(
      JSON.stringify(newMetadataFile)
    );

    console.log(`Published epoch ${newEpochFile.epoch}:`);
    console.log(`  Epoch blob ID: ${newEpochBlobId}`);
    console.log(`  Metadata blob ID: ${newMetadataBlobId}`);

    return {
      epochBlobId: newEpochBlobId,
      metadataBlobId: newMetadataBlobId,
    };
  }
}
