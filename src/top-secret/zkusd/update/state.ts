import { Field, Struct, UInt32, UInt64 } from 'o1js';
import { VaultMap } from '../data/vault-map.js';
import { ZkUsdMap } from '../data/zkusd-map.js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  vaultMap: VaultMap,
  zkUsdMap: ZkUsdMap,
  sequence: UInt64,
  blockNumber: UInt32,
}) {
  static new(): ZkUsdState {
    return new ZkUsdState({
      vaultMap: new VaultMap(),
      zkUsdMap: new ZkUsdMap(),
      sequence: UInt64.from(0),
      blockNumber: UInt32.from(0),
    });
  }

  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.vaultMap.root.assertEquals(b.vaultMap.root);
    a.zkUsdMap.root.assertEquals(b.zkUsdMap.root);
    a.sequence.assertEquals(b.sequence);
    a.blockNumber.assertEquals(b.blockNumber);
  }
}
