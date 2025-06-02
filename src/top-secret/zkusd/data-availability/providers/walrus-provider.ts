import { WalrusClient } from '@mysten/walrus';
import { StorageMetadata, StorageProvider } from './storage-provider.js';
import {
  WalrusNetwork,
  WalrusClientOptions,
  createWalrusClient,
} from '../walrus/walrus-client.js';
import { RetryableWalrusClientError } from '@mysten/walrus';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { suiSigner } from '../../config/keys.js';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

export interface WalrusProviderOptions extends WalrusClientOptions {
  defaultEpochs?: number;
  defaultAddress?: string;
}

export class WalrusProvider implements StorageProvider {
  private walrusClient: WalrusClient;
  private readonly network: WalrusNetwork;
  private readonly defaultEpochs: number;
  private readonly defaultAddress?: string;
  private readonly clientOptions: WalrusClientOptions;
  private readonly signer: Ed25519Keypair;
  private readonly suiClient: SuiClient;

  constructor(options: WalrusProviderOptions = {}, client: WalrusClient) {
    this.network = options.network ?? 'testnet';
    this.defaultEpochs = options.defaultEpochs ?? 10;
    this.defaultAddress = options.defaultAddress;
    this.clientOptions = options;
    this.walrusClient = client;
    this.signer = suiSigner;
    this.suiClient = new SuiClient({
      url: getFullnodeUrl('testnet'),
    });
  }

  static async createWalrusProvider(
    network: WalrusNetwork,
    options: WalrusProviderOptions = {}
  ): Promise<WalrusProvider> {
    const client = await createWalrusClient(options);
    console.log(options);
    return new WalrusProvider(options, client);
  }

  async store(data: string, metadata?: StorageMetadata): Promise<string> {
    const maxRetries = 3;
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const blob = new TextEncoder().encode(data);
        const epochs = metadata?.numEpochs ?? this.defaultEpochs;

        const result = await this.walrusClient.writeBlob({
          blob,
          deletable: false,
          epochs,
          signer: this.signer,
        });

        return result.blobId;
      } catch (error) {
        console.log(error);
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Handle retryable errors
        if (error instanceof RetryableWalrusClientError) {
          console.warn(
            `Retryable error on attempt ${attempt}, resetting client...`
          );
          this.resetClient();
        }

        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(
      `Failed to store data after ${maxRetries} attempts: ${lastError!.message}`
    );
  }

  async retrieve(blobId: string, metadata?: StorageMetadata): Promise<string> {
    try {
      const blob = await this.walrusClient.readBlob({ blobId });
      return new TextDecoder().decode(blob);
    } catch (error) {
      if (error instanceof RetryableWalrusClientError) {
        this.resetClient();

        // Retry once after reset
        const blob = await this.walrusClient.readBlob({ blobId });
        return new TextDecoder().decode(blob);
      }

      throw new Error(
        `Failed to retrieve data from Walrus for blob ID ${blobId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async cleanAfterCheckpoint(checkpointBlobId: string): Promise<void> {
    //TODO: Implement
  }

  /**
   * Check if a blob exists
   */
  async exists(blobId: string): Promise<boolean> {
    try {
      const blob = await this.walrusClient.readBlob({ blobId });
      return blob !== null;
    } catch {
      return false;
    }
  }

  private async resetClient(): Promise<void> {
    this.walrusClient.reset();
    this.walrusClient = await createWalrusClient(this.clientOptions);
  }
}
