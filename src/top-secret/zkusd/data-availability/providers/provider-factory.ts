import { WalrusProvider } from './walrus-provider.js';
import { LocalProvider } from './local-provider.js';
import { StorageProvider } from './storage-provider.js';
import { WalrusNetwork } from '../walrus/walrus-client.js';

export type ProviderType = 'walrus' | 'local';

// Walrus provider options
export interface WalrusOptions {
  network?: WalrusNetwork;
  defaultEpochs?: number;
  defaultAddress?: string;
  timeout?: number;
  enableErrorLogging?: boolean;
  maxRetries?: number;
}

// Local provider options
export interface LocalOptions {
  baseDir?: string;
}

export class ProviderFactory {
  /**
   * Create a Walrus provider with specified options
   */
  static async createWalrusProvider(
    options: WalrusOptions = {}
  ): Promise<StorageProvider> {
    const network = options.network ?? 'testnet';
    return await WalrusProvider.createWalrusProvider(network, options);
  }

  /**
   * Create a Local provider with specified options
   */
  static createLocalProvider(options: LocalOptions = {}): StorageProvider {
    return new LocalProvider(options);
  }

  /**
   * Create a provider by type with options
   */
  static async createProvider(
    type: ProviderType,
    options: any = {}
  ): Promise<StorageProvider> {
    switch (type) {
      case 'walrus':
        return await ProviderFactory.createWalrusProvider(options);

      case 'local':
        return ProviderFactory.createLocalProvider(options);

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}
