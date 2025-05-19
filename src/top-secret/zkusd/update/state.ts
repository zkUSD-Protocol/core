import { Field, Struct, UInt32, UInt64 } from 'o1js';
import { UtxoTree } from '../data/utxo-tree.js';
import { NullifierMap } from '../data/nullifier-map.js';
import { VaultMap } from '../data/vault-map.js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  vaultMap: VaultMap,
  utxoTreeRoot: Field,
  nullifierMapRoot: Field,
  sequence: UInt64,
  blockNumber: UInt32,
}) {
  static new(): ZkUsdState {
    return new ZkUsdState({
      vaultMap: new VaultMap(),
      utxoTreeRoot: new UtxoTree().getRoot(),
      nullifierMapRoot: new NullifierMap().getRoot(),
      sequence: UInt64.from(0),
      blockNumber: UInt32.from(0),
    });
  }

  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.vaultMap.root.assertEquals(b.vaultMap.root);
    a.utxoTreeRoot.assertEquals(b.utxoTreeRoot);
    a.nullifierMapRoot.assertEquals(b.nullifierMapRoot);
    a.sequence.assertEquals(b.sequence);
    a.blockNumber.assertEquals(b.blockNumber);
  }
}
