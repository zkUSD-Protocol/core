// ============================================================================
// Utility Types
// ============================================================================

import { PrivateKey, PublicKey, Field } from 'o1js';

/**
 * blockchain is the type for the chain ID.
 */
export type blockchain = 'local' | 'devnet' | 'lightnet' | 'mainnet' | 'zeko';

/**
 * @notice Keypair type for managing public/private key pairs
 */
export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export type Account = { publicKey: PublicKey; tokenId?: Field };

/**
 * @notice Helper type for contract instances
 */
export interface ContractInstance<T> {
  contract: T extends new (...args: any[]) => infer R ? R : T;
}

export type WithDefault<K extends string, V, D extends K = K> = {
  [key in K]: V;
} & {
  default: D;
};

export function singleDefault<K extends string, V>(
  key: K,
  value: V
): WithDefault<K, V, K> {
  return {
    [key]: value,
    default: key,
  } as WithDefault<K, V, K>;
}

export type SizedArray<T, L extends number> = [T, ...T[]] & { length: L };

export function createSizedArray<T, L extends number>(
  data: T[],
  expectedLength: L = data.length as L // Auto-infer length if possible
): SizedArray<T, L> {
  if (data.length !== expectedLength) {
    throw new Error(
      `Invalid array length: expected ${expectedLength}, got ${data.length}`
    );
  }
  return data as SizedArray<T, L>;
}
