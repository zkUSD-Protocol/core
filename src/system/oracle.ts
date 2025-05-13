// ============================================================================
// Oracle & Price Types

import {
  Struct,
  Provable,
  PublicKey,
  Field,
  Poseidon,
  UInt64,
  UInt32,
} from 'o1js';

// ============================================================================
const MAX_ORACLE_COUNT = 8;

/**
 * @notice Whitelist of authorized oracle addresses
 */
export class OracleWhitelist extends Struct({
  addresses: Provable.Array(PublicKey, MAX_ORACLE_COUNT),
}) {
  static MAX_PARTICIPANTS = MAX_ORACLE_COUNT;

  static hash(whitelist: OracleWhitelist): Field {
    return Poseidon.hash(OracleWhitelist.toFields(whitelist));
  }

/**
 * Constructs an OracleWhitelist from an array of Base58-encoded public key strings.
 * Pads the list to MAX_PARTICIPANTS with empty/default keys.
 */
static fromBase58(
  base58Keys: string[]
): OracleWhitelist {
  const addresses: PublicKey[] = [];

  const max = OracleWhitelist.MAX_PARTICIPANTS;
  if (base58Keys.length > max) {
    throw new Error(`Whitelist exceeds max of ${max} entries`);
  }

  for (let i = 0; i < max; i++) {
    if (i < base58Keys.length) {
      addresses.push(PublicKey.fromBase58(base58Keys[i]));
    } else {
      // Fill with dummy public keys if not enough entries
      addresses.push(PublicKey.empty());
    }
  }

  return new OracleWhitelist({ addresses });
}
}

/**
 * @notice Represents a verified MINA price
 */
export class MinaPrice extends Struct({
  priceNanoUSD: UInt64,
  currentBlockHeight: UInt32,
}) {}
