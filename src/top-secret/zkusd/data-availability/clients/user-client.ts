import { IntentProof, JsonIntentProof } from '../../types/intent-proof.js';
import { UserDAInterface } from '../../validator/da-interface.js';

export type WalrusEnvironment = 'local' | 'testnet';

export interface UserDAClientConfig {
  /** Walrus environment (default: 'local') */
  environment?: WalrusEnvironment;
  /** Sui address to send the object to (optional) */
  address?: string;
  /** Number of epochs to store the data (default: 2) */
  numEpochs?: number;
}

export class UserDAClient implements UserDAInterface {
  private readonly config: UserDAClientConfig;
  private readonly publisherUrl: string;
  private readonly readerUrl: string;
  private readonly minEpochs = 2;
  private readonly maxEpochs = 53;

  constructor(config: UserDAClientConfig = {}) {
    this.config = { environment: 'local', ...config };

    const urls = this.getEnvironmentUrls(this.config.environment!);
    this.publisherUrl = urls.publisherUrl;
    this.readerUrl = urls.readerUrl;
  }

  private getEnvironmentUrls(environment: WalrusEnvironment) {
    switch (environment) {
      case 'local':
        return {
          publisherUrl: 'http://127.0.0.1:31417',
          readerUrl: 'http://127.0.0.1:31417/v1/blobs/',
        };
      case 'testnet':
        return {
          publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
          readerUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/',
        };
      default:
        throw new Error(`Unknown Walrus environment: ${environment}`);
    }
  }

  private normalizeEpochs(numEpochs: number): number {
    return Math.min(Math.max(numEpochs, this.minEpochs), this.maxEpochs);
  }

  async publishIntentProof(intentProof: IntentProof): Promise<string> {
    try {
      // Convert the intent proof to JSON
      const jsonIntentProof: JsonIntentProof = {
        kind: intentProof.kind,
        proof: intentProof.proof.toJSON(),
      };

      const serializedData = JSON.stringify(jsonIntentProof);

      // Store to Walrus
      const blobId = await this.saveToWalrus(serializedData);
      return blobId;
    } catch (error) {
      throw new Error(
        `Failed to publish intent proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async saveToWalrus(data: string): Promise<string> {
    const sendToParam = this.config.address
      ? `&send_object_to=${this.config.address}`
      : '';
    const epochs = this.normalizeEpochs(this.config.numEpochs ?? 2);

    console.log(
      `Writing Blob to Walrus of size ${data.length} bytes (${(data.length / 1024).toFixed(2)} KB)`
    );
    console.time('walrus-write');

    try {
      const response = await fetch(
        `${this.publisherUrl}/v1/blobs?epochs=${epochs}${sendToParam}`,
        {
          method: 'PUT',
          body: data,
        }
      );

      console.timeEnd('walrus-write');

      if (response.status === 200) {
        const info = await response.json();
        const blobId =
          info?.newlyCreated?.blobObject?.blobId ??
          info?.alreadyCertified?.blobId;

        if (!blobId) {
          throw new Error('No blob ID returned from Walrus');
        }

        console.log('Walrus blobId:', blobId);
        return blobId;
      } else {
        throw new Error(
          `Walrus save failed: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.timeEnd('walrus-write');
      throw error;
    }
  }

  // Utility method to read data back (useful for testing)
  async readFromWalrus(blobId: string): Promise<string> {
    if (!blobId) {
      throw new Error('blobId is not provided');
    }

    console.log('Reading walrus blob:', blobId);
    console.time('walrus-read');

    try {
      const response = await fetch(`${this.readerUrl}${blobId}`);
      console.timeEnd('walrus-read');

      if (!response.ok) {
        throw new Error(
          `Walrus read failed: ${response.status} ${response.statusText}`
        );
      }

      return await response.text();
    } catch (error) {
      console.timeEnd('walrus-read');
      throw error;
    }
  }

  // Convenience factory methods
  static forLocal(
    config: Omit<UserDAClientConfig, 'environment'> = {}
  ): UserDAClient {
    return new UserDAClient({ ...config, environment: 'local' });
  }

  static forTestnet(
    config: Omit<UserDAClientConfig, 'environment'> = {}
  ): UserDAClient {
    return new UserDAClient({ ...config, environment: 'testnet' });
  }
}
