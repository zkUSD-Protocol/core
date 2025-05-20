import { Bool, Field, Struct, UInt32, UInt64, UInt8 } from 'o1js';
import { VaultMap } from './vault-map.js';
import { ZkUsdMap } from './zkusd-map.js';
import { Vault } from '../../../system/vault.js';

/**
 * Represents the state of the ZkUSD system.
 * Contains the roots of the UTXO tree and nullifier map.
 */
export class ZkUsdState extends Struct({
  vaultMapRoot: Field,
  zkUsdMapRoot: Field,
  sequence: UInt32,
  blockNumber: UInt32,
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
      vaultMapRoot: vaultMap.root,
      zkUsdMapRoot: zkUsdMap.root,
      sequence: UInt32.from(0),
      blockNumber: UInt32.from(0),
      validPriceBlockCount: UInt8.from(1),
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(150),
      liquidationBonusRatio: UInt8.from(110),
      vaultDebtCeiling: UInt64.from(100000e9), // 100k ZKUSD
      oraclesHash: Field(0),
    });
  }

  static assertEqual(a: ZkUsdState, b: ZkUsdState) {
    a.vaultMapRoot.assertEquals(b.vaultMapRoot);
    a.zkUsdMapRoot.assertEquals(b.zkUsdMapRoot);
    a.sequence.assertEquals(b.sequence);
    a.blockNumber.assertEquals(b.blockNumber);
    a.validPriceBlockCount.assertEquals(b.validPriceBlockCount);
    a.emergencyStop.assertEquals(b.emergencyStop);
    a.collateralRatio.assertEquals(b.collateralRatio);
    a.liquidationBonusRatio.assertEquals(b.liquidationBonusRatio);
    a.vaultDebtCeiling.assertEquals(b.vaultDebtCeiling);
    a.oraclesHash.assertEquals(b.oraclesHash);
  }

  /**
   * Creates a modified copy of the ZkUsdState with specified changes.
   * Automatically increments the sequence number by 1 unless overridden.
   */
  static update(
    state: ZkUsdState,
    changes: Partial<{
      vaultMapRoot: Field;
      zkUsdMapRoot: Field;
      sequence: UInt32;
      blockNumber: UInt32;
      validPriceBlockCount: UInt8;
      emergencyStop: Bool;
      collateralRatio: UInt8;
      liquidationBonusRatio: UInt8;
      vaultDebtCeiling: UInt64;
      oraclesHash: Field;
    }>
  ): ZkUsdState {
    // By default increment sequence by 1 if not explicitly provided
    const newSequence = changes.sequence ?? state.sequence.add(UInt32.from(1));

    return new ZkUsdState({
      vaultMapRoot: changes.vaultMapRoot ?? state.vaultMapRoot,
      zkUsdMapRoot: changes.zkUsdMapRoot ?? state.zkUsdMapRoot,
      sequence: newSequence,
      blockNumber: changes.blockNumber ?? state.blockNumber,
      validPriceBlockCount:
        changes.validPriceBlockCount ?? state.validPriceBlockCount,
      emergencyStop: changes.emergencyStop ?? state.emergencyStop,
      collateralRatio: changes.collateralRatio ?? state.collateralRatio,
      liquidationBonusRatio:
        changes.liquidationBonusRatio ?? state.liquidationBonusRatio,
      vaultDebtCeiling: changes.vaultDebtCeiling ?? state.vaultDebtCeiling,
      oraclesHash: changes.oraclesHash ?? state.oraclesHash,
    });
  }
}
