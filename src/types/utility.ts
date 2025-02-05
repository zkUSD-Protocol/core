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

/**
 * Rename a key in an object type from K to NewK.
 */
export type Rename<T, K extends keyof T, NewK extends string> = Omit<T, K> & { [P in NewK]: T[K] };

/**
 * Function to rename a field in an object
 */
export function renameField<T, K extends keyof T, NewK extends string>(
  obj: T,
  oldKey: K,
  newKey: NewK
): Rename<T, K, NewK> {
  const { [oldKey]: value, ...rest } = obj;
  return { ...rest, [newKey]: value } as Rename<T, K, NewK>;
}

/**
 * Insert a new field into an object type
 */
export type InsertField<T, K extends string, V> = T & { [P in K]: V };

/**
 * Function to insert a new field into an object
 */
export function insertField<T, K extends string, V>(
  obj: T,
  key: K,
  value: V
): InsertField<T, K, V> {
  return { ...obj, [key]: value } as InsertField<T, K, V>;
}

/**
 * Deep update utility: Recursively updates a nested field in an object.
 */
export type DeepUpdate<T, Path extends string, F extends (value: any) => any> =
  Path extends `${infer K}.${infer Rest}`
  ? K extends keyof T
  ? { [P in keyof T]: P extends K ? DeepUpdate<T[K], Rest, F> : T[P] }
  : T
  : Path extends keyof T
  ? { [P in keyof T]: P extends Path ? ReturnType<F> : T[P] }
  : T;

/**
 * Recursively updates a nested field in an object using a provided function.
 */
export function updateNestedField<T, Path extends string, F extends (value: any) => any>(
  obj: T,
  path: Path,
  updater: F
): DeepUpdate<T, Path, F> {
  const keys = path.split(".");

  function recursiveUpdate(obj: any, keys: string[]): any {
    if (keys.length === 0) return obj;
    const [key, ...rest] = keys;

    if (!(key in obj)) return obj; // If key doesn't exist, return unchanged object

    if (rest.length === 0) {
      return { ...obj, [key]: updater(obj[key]) };
    }

    return {
      ...obj,
      [key]: recursiveUpdate(obj[key], rest),
    };
  }

  return recursiveUpdate(obj, keys) as DeepUpdate<T, Path, F>;
}
