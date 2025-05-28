import { DataAvailabilityInterface } from './interfaces/data-availability.js';
import { WalrusProvider } from './providers/walrus-provider.js';
import { AnyIntentProof } from '../types/intent-proof.js';
import { EpochState } from '../data/epoch-state.js';

export class DataAvailabilityClient implements DataAvailabilityInterface {
  private readonly storageProvider: WalrusProvider;

  constructor(walrusOptions?: {
    defaultEpochs?: number;
    defaultAddress?: string;
  }) {
    this.storageProvider = new WalrusProvider(walrusOptions);
  }

  async fetchIntentProof(intentBlobHandle: string): Promise<AnyIntentProof> {
    try {
      const rawData = await this.storageProvider.retrieve(intentBlobHandle);

      // Parse and validate the intent proof
      const intentProof = JSON.parse(rawData) as AnyIntentProof;

      return intentProof;
    } catch (error) {
      throw new Error(
        `Failed to fetch intent proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async fetchFullEpochState(
    metadataBlobHandle: string,
    epochNumber: number
  ): Promise<EpochState> {
    try {
      const rawData = await this.storageProvider.retrieve(metadataBlobHandle);

      // Parse the metadata file
      const metadata: MetadataFile = JSON.parse(rawData);

      // Find the epoch in the metadata
      const epoch = metadata.epochs.find((e) => e.epoch === epochNumber);

      if (!epoch) {
        throw new Error(`Epoch ${epochNumber} not found in metadata`);
      }

      return epochState;
    } catch (error) {
      throw new Error(
        `Failed to fetch epoch state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async publishFinalEpochState(computedEpochState: EpochState): Promise<void> {
    try {
      const serializedState = JSON.stringify(computedEpochState);

      // Store with higher durability for important epoch states
      const blobId = await this.storageProvider.storeWithRetry(
        serializedState,
        { numEpochs: 10 }, // Keep epoch states longer
        3 // Retry up to 3 times
      );

      console.log(`Published epoch state to Walrus with blob ID: ${blobId}`);
    } catch (error) {
      throw new Error(
        `Failed to publish epoch state: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
