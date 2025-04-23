import { Field, Struct } from 'o1js';
import {
  BoolPrecondition,
  HashPrecondition,
  UInt64Precondition,
  UInt8Precondition,
} from './simple-preconditions.js';

export type ZkusdProtocolPreconditionsFields = {
  emergencyStop: BoolPrecondition;
  collateralRatio: UInt8Precondition;
  validPriceBlockCount: UInt8Precondition;
  liquidationBonusRatio: UInt8Precondition;
  oracleWhitelistHash: HashPrecondition;
  configMerkleRoot: HashPrecondition;
  vaultCreationDisabled: BoolPrecondition;
  vaultDebtCeiling: UInt64Precondition;
};

/**
 * This class wraps any constraints on the protocol state. Each field either
 * has a real constraint or is 'unconstrained', meaning it is always satisfied.
 */
export class ZkusdProtocolPreconditions extends Struct({
  emergencyStop: BoolPrecondition,
  collateralRatio: UInt8Precondition,
  validPriceBlockCount: UInt8Precondition,
  liquidationBonusRatio: UInt8Precondition,
  oracleWhitelistHash: HashPrecondition,
  configMerkleRoot: HashPrecondition,
  vaultCreationDisabled: BoolPrecondition,
  vaultDebtCeiling: UInt64Precondition,
}) {
  /**
   * Returns a precondition that is always satisfied.
   * This is useful for testing or when you don't care about the preconditions.
   */
  static always() {
    return ZkusdProtocolPreconditions.create();
  }

  static create(
    args?: Partial<ZkusdProtocolPreconditionsFields>
  ): ZkusdProtocolPreconditions {
    return new ZkusdProtocolPreconditions({
      emergencyStop: args?.emergencyStop || BoolPrecondition.unconstrained(),
      collateralRatio:
        args?.collateralRatio || UInt8Precondition.unconstrained(),
      validPriceBlockCount:
        args?.validPriceBlockCount || UInt8Precondition.unconstrained(),
      liquidationBonusRatio:
        args?.liquidationBonusRatio || UInt8Precondition.unconstrained(),
      oracleWhitelistHash:
        args?.oracleWhitelistHash || HashPrecondition.unconstrained(),
      configMerkleRoot:
        args?.configMerkleRoot || HashPrecondition.unconstrained(),
      vaultCreationDisabled:
        args?.vaultCreationDisabled || BoolPrecondition.unconstrained(),
      vaultDebtCeiling:
        args?.vaultDebtCeiling || UInt64Precondition.unconstrained(),
    });
  }
  toFields(): Field[] {
    return [
      ...this.emergencyStop.toFields(),
      ...this.collateralRatio.toFields(),
      ...this.validPriceBlockCount.toFields(),
      ...this.liquidationBonusRatio.toFields(),
      ...this.oracleWhitelistHash.toFields(),
      ...this.configMerkleRoot.toFields(),
      ...this.vaultCreationDisabled.toFields(),
      ...this.vaultDebtCeiling.toFields(),
    ];
  }
}
