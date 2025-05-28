import { saveToWalrus, readFromWalrus } from '../utils/walrus.js';

export interface StorageProvider {
  store(data: string, metadata?: StorageMetadata): Promise<string>;
  retrieve(blobId: string): Promise<string>;
  getUrl(blobId: string): Promise<string>;
}

export interface StorageMetadata {
  numEpochs?: number;
  address?: string;
  contentType?: string;
}

export class WalrusProvider implements StorageProvider {
  private readonly defaultEpochs: number;
  private readonly defaultAddress?: string;

  constructor(options?: { defaultEpochs?: number; defaultAddress?: string }) {
    this.defaultEpochs = options?.defaultEpochs ?? 2;
    this.defaultAddress = options?.defaultAddress;
  }

  async store(data: string, metadata?: StorageMetadata): Promise<string> {
    try {
      const blobId = await saveToWalrus({
        data,
        address: metadata?.address ?? this.defaultAddress,
        numEpochs: metadata?.numEpochs ?? this.defaultEpochs,
      });

      if (!blobId) {
        throw new Error('Failed to store data in Walrus: no blob ID returned');
      }

      return blobId;
    } catch (error) {
      throw new Error(
        `Walrus storage failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async retrieve(blobId: string): Promise<string> {
    try {
      const data = await readFromWalrus({ blobId });

      if (!data) {
        throw new Error(
          `Failed to retrieve data from Walrus for blob ID: ${blobId}`
        );
      }

      return data;
    } catch (error) {
      throw new Error(
        `Walrus retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getUrl(blobId: string): Promise<string> {
    try {
      // Import your existing getWalrusUrl function
      const { getWalrusUrl } = await import('../utils/walrus.js');
      return await getWalrusUrl({ blobId });
    } catch (error) {
      throw new Error(
        `Failed to get Walrus URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Walrus-specific helper methods
  async storeWithRetry(
    data: string,
    metadata?: StorageMetadata,
    maxRetries: number = 3
  ): Promise<string> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.store(data, metadata);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(
      `Failed to store after ${maxRetries} attempts: ${lastError!.message}`
    );
  }

  // Check if blob exists without downloading full content
  async exists(blobId: string): Promise<boolean> {
    try {
      const url = await this.getUrl(blobId);
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
