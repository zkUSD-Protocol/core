// ============================================================================
// Utility Types
// ============================================================================

import { PrivateKey, PublicKey } from 'o1js';

/**
 * @notice Keypair type for managing public/private key pairs
 */
export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

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
