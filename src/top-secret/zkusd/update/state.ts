import { Field, Struct } from 'o1js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  utxoTreeRoot: Field,
  nullifierMapRoot: Field,
}) {
  static empty(): ZkUsdState {
    return new ZkUsdState({
      utxoTreeRoot: Field(0),
      nullifierMapRoot: Field(0),
    });
  }

  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.utxoTreeRoot.assertEquals(b.utxoTreeRoot);
    a.nullifierMapRoot.assertEquals(b.nullifierMapRoot);
  }
}
