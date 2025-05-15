import { Field, Struct } from 'o1js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  utxoTreeRoot: Field,
  nullifierMapRoot: Field,
}) {}
