import { Field, Struct } from 'o1js';
import { BoolPrecondition, HashPrecondition, UInt8Precondition } from './simple-preconditions.js';

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
}) {
  static always() {
    return ZkusdProtocolPreconditions.create();
  }
  static create(args?: {
    emergencyStop?: BoolPrecondition;
    collateralRatio?: UInt8Precondition;
    validPriceBlockCount?: UInt8Precondition;
    liquidationBonusRatio?: UInt8Precondition;
    oracleWhitelistHash?: HashPrecondition;
    configMerkleRoot?: HashPrecondition;
  }): ZkusdProtocolPreconditions {
    return new ZkusdProtocolPreconditions({
      emergencyStop: args?.emergencyStop || BoolPrecondition.mkUnconstrained(),
      collateralRatio: args?.collateralRatio || UInt8Precondition.mkUnconstrained(),
      validPriceBlockCount: args?.validPriceBlockCount || UInt8Precondition.mkUnconstrained(),
      liquidationBonusRatio: args?.liquidationBonusRatio || UInt8Precondition.mkUnconstrained(),
      oracleWhitelistHash: args?.oracleWhitelistHash || HashPrecondition.mkUnconstrained(),
      configMerkleRoot: args?.configMerkleRoot || HashPrecondition.mkUnconstrained(),
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
    ];
  }
}
