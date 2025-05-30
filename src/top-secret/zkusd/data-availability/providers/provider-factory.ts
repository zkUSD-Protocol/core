import { WalrusProvider } from './walrus-provider.js';
import { LocalProvider } from './local-provider.js';
import { StorageProvider } from './storage-provider.js';

export type ProviderType = 'walrus' | 'local';

export interface ProviderConfig {
  type: ProviderType;
  walrus?: {
    defaultBlocks?: number;
    defaultAddress?: string;
  };
  local?: {
    baseDir?: string;
  };
}

export class ProviderFactory {
  static createProvider(config: ProviderConfig): StorageProvider {
    switch (config.type) {
      case 'walrus':
        return new WalrusProvider(config.walrus);

      case 'local':
        return new LocalProvider(config.local);

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }
}
