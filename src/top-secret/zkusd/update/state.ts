import { Field, Struct, UInt32, UInt64 } from 'o1js';
import { VaultMap } from '../data/vault-map.js';
import { ZkUsdMap } from '../data/zkusd-map.js';
import { Vault } from '../../../system/vault.js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  vaultMapRoot: Field,
  zkUsdMapRoot: Field,
  sequence: UInt64,
  blockNumber: UInt32,
}) {
  static new(): ZkUsdState {
    return new ZkUsdState({
      vaultMapRoot: new VaultMap().root,
      zkUsdMapRoot: new ZkUsdMap().root,
      sequence: UInt64.from(0),
      blockNumber: UInt32.from(0),
    });
  }

  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.vaultMapRoot.assertEquals(b.vaultMapRoot);
    a.zkUsdMapRoot.assertEquals(b.zkUsdMapRoot);
    a.sequence.assertEquals(b.sequence);
    a.blockNumber.assertEquals(b.blockNumber);
  }
}
