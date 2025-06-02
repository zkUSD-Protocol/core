import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

export type WalrusNetwork = 'mainnet' | 'testnet' | 'localnet';

// Hardcoded local network configuration
const LOCAL_NETWORK_CONFIG = {
  systemObjectId:
    '0x8fa6fb1f658553e79de1569dabadf462162d4744281fabb31b152e218bd92150',
  stakingPoolId:
    '0x58eaaf7c7ba967a963a2d07abb85b32520294660c802ba91b2e61997949daed9',
};

export interface WalrusClientOptions {
  network?: WalrusNetwork;
  timeout?: number;
  customRpcUrl?: string;
  maxRetries?: number;
}

/**
 * Create SuiClient for the network
 */
function createSuiClient(
  network: WalrusNetwork,
  customRpcUrl?: string
): SuiClient {
  if (customRpcUrl) {
    return new SuiClient({ url: customRpcUrl });
  }

  // Use SDK defaults for known networks
  if (network === 'localnet') {
    return new SuiClient({ url: getFullnodeUrl('localnet') });
  }

  return new SuiClient({ url: getFullnodeUrl(network) });
}

/**
 * Create storage node client options with retry logic and error handling
 */
function createStorageNodeOptions(options: WalrusClientOptions) {
  const storageOptions: any = {};

  if (options.timeout) {
    storageOptions.timeout = options.timeout;
  }

  if (options.maxRetries) {
    // Add custom fetch with retry logic
    const originalFetch = globalThis.fetch;
    storageOptions.fetch = async (url: string, init?: RequestInit) => {
      let lastError: Error;

      for (let attempt = 1; attempt <= options.maxRetries!; attempt++) {
        try {
          return await originalFetch(url, init);
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error('Unknown error');

          if (attempt === options.maxRetries) {
            break;
          }

          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError!;
    };
  }

  return Object.keys(storageOptions).length > 0 ? storageOptions : undefined;
}

/**
 * Create a WalrusClient for the specified network
 */
export async function createWalrusClient(
  options: WalrusClientOptions = {}
): Promise<WalrusClient> {
  const network = options.network ?? 'testnet';

  // Create SuiClient based on network
  const suiClient = createSuiClient(network, options.customRpcUrl);

  // For testnet and mainnet, use the SDK's built-in configurations
  if (network === 'testnet' || network === 'mainnet') {
    return new WalrusClient({
      network,
      suiClient,
      storageNodeClientOptions: createStorageNodeOptions(options),
    });
  }

  // For local network, use hardcoded package configuration
  return new WalrusClient({
    suiClient,
    packageConfig: LOCAL_NETWORK_CONFIG,
    storageNodeClientOptions: createStorageNodeOptions(options),
  });
}
