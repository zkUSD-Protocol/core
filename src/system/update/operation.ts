import { Field, Struct } from 'o1js';
import {
  BoolOperation,
  FieldOperation,
  UInt8Operation,
} from './simple-operations.js';

/**
 * The fields of ZkusdProtocolUpdateOperation.
 * This is just a TypeScript type, not a class.
 */
type ZkusdProtocolUpdateOperationFields = {
  emergencyStop: BoolOperation;
  collateralRatio: UInt8Operation;
  validPriceBlockCount: UInt8Operation;
  liquidationBonusRatio: UInt8Operation;
  oracleWhitelistHash: FieldOperation;
  configMerkleRoot: FieldOperation;
  newVerificationKey: FieldOperation;
};

/**
 * A convenience function that returns a "no-op" version of every field.
 * This is used internally to fill in missing fields in partials, or
 * to produce a base "all-noops" operation.
 */
function mkAllNoops(): ZkusdProtocolUpdateOperationFields {
  return {
    emergencyStop: BoolOperation.mkNoop(),
    collateralRatio: UInt8Operation.mkNoop(),
    validPriceBlockCount: UInt8Operation.mkNoop(),
    liquidationBonusRatio: UInt8Operation.mkNoop(),
    oracleWhitelistHash: FieldOperation.mkNoop(),
    configMerkleRoot: FieldOperation.mkNoop(),
    newVerificationKey: FieldOperation.mkNoop(),
  };
}

/**
 * The main class. We only store the final fields, but we provide static
 * methods to create or merge them in a more flexible, minimal way.
 */
export class ZkusdProtocolUpdateOperation extends Struct({
  emergencyStop: BoolOperation,
  collateralRatio: UInt8Operation,
  validPriceBlockCount: UInt8Operation,
  liquidationBonusRatio: UInt8Operation,
  oracleWhitelistHash: FieldOperation,
  configMerkleRoot: FieldOperation,
  newVerificationKey: FieldOperation,
}) {
  /**
   * Creates a new operation from a partial set of fields,
   * filling missing fields with no-ops.
   */
  static mkFromPartial(
    partial: Partial<ZkusdProtocolUpdateOperationFields>
  ): ZkusdProtocolUpdateOperation {
    // Fill in no-ops for missing fields
    const allNoops = mkAllNoops();
    const filled: ZkusdProtocolUpdateOperationFields = {
      emergencyStop: partial.emergencyStop ?? allNoops.emergencyStop,
      collateralRatio: partial.collateralRatio ?? allNoops.collateralRatio,
      validPriceBlockCount:
        partial.validPriceBlockCount ?? allNoops.validPriceBlockCount,
      liquidationBonusRatio:
        partial.liquidationBonusRatio ?? allNoops.liquidationBonusRatio,
      oracleWhitelistHash:
        partial.oracleWhitelistHash ?? allNoops.oracleWhitelistHash,
      configMerkleRoot:
        partial.configMerkleRoot ?? allNoops.configMerkleRoot,
      newVerificationKey:
        partial.newVerificationKey ?? allNoops.newVerificationKey,
    };
    return new ZkusdProtocolUpdateOperation(filled);
  }

  static mkNoop(): ZkusdProtocolUpdateOperation {
    return new ZkusdProtocolUpdateOperation(mkAllNoops());
  }

  toFields(): Field[] {
    return [
      ...this.emergencyStop.toFields(),
      ...this.collateralRatio.toFields(),
      ...this.validPriceBlockCount.toFields(),
      ...this.liquidationBonusRatio.toFields(),
      ...this.oracleWhitelistHash.toFields(),
      ...this.configMerkleRoot.toFields(),
      ...this.newVerificationKey.toFields(),
    ];
  }
}
