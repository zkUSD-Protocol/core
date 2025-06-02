import { Bool, Field, Struct, UInt32, UInt64, UInt8 } from 'o1js';
import { VaultMap } from './maps/vault-map.js';
import { ZkUsdMap } from './maps/zkusd-map.js';
import { Vault } from '../../../system/vault.js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  intentVaultMapRoot: Field,
  intentZkUsdMapRoot: Field,
  liveVaultMapRoot: Field,
  liveZkUsdMapRoot: Field,
  validPriceBlockCount: UInt8,
  emergencyStop: Bool,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
  vaultDebtCeiling: UInt64,
  oraclesHash: Field,
}) {
  static new({
    vaultMap,
    zkUsdMap,
  }: {
    vaultMap: VaultMap;
    zkUsdMap: ZkUsdMap;
  }): ZkUsdState {
    return new ZkUsdState({
      intentVaultMapRoot: vaultMap.root,
      intentZkUsdMapRoot: zkUsdMap.root,
      liveVaultMapRoot: vaultMap.root,
      liveZkUsdMapRoot: zkUsdMap.root,
      validPriceBlockCount: UInt8.from(1),
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(150),
      liquidationBonusRatio: UInt8.from(110),
      vaultDebtCeiling: UInt64.from(100000e9), // 100k ZKUSD
      oraclesHash: Field(0),
    });
  }
  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.intentVaultMapRoot.assertEquals(b.intentVaultMapRoot);
    a.intentZkUsdMapRoot.assertEquals(b.intentZkUsdMapRoot);
    a.liveVaultMapRoot.assertEquals(b.liveVaultMapRoot);
    a.liveZkUsdMapRoot.assertEquals(b.liveZkUsdMapRoot);
    a.validPriceBlockCount.assertEquals(b.validPriceBlockCount);
    a.emergencyStop.assertEquals(b.emergencyStop);
    a.collateralRatio.assertEquals(b.collateralRatio);
    a.liquidationBonusRatio.assertEquals(b.liquidationBonusRatio);
    a.vaultDebtCeiling.assertEquals(b.vaultDebtCeiling);
    a.oraclesHash.assertEquals(b.oraclesHash);
  }
}
