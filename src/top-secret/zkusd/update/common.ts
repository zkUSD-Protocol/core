import { Field, Struct } from 'o1js';
import { UtxoTree } from '../data/utxo-tree';
import { NullifierMap } from '../data/nullifier-map';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  utxoTreeRoot: Field,
  nullifierMapRoot: Field,
}) {}
