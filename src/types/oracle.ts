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
}

/**
 * @notice Represents a verified MINA price
 */
export class MinaPrice extends Struct({
  priceNanoUSD: UInt64,
  currentBlockHeight: UInt32,
}) {}
