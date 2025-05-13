import { Field, Provable, Struct } from 'o1js';
import {
  BoolOperation,
  FieldOperation,
  printOperation,
  UInt64Operation,
  UInt8Operation,
} from './simple-operations.js';

/**
 * The fields of EngineUpdateOperation.
 * This is just a TypeScript type, not a class.
 */
export type EngineUpdateOperationFields = {
  emergencyStop: BoolOperation;
  vaultCreationDisabled: BoolOperation;
  collateralRatio: UInt8Operation;
  validPriceBlockCount: UInt8Operation;
  liquidationBonusRatio: UInt8Operation;
  oracleWhitelistHash: FieldOperation;
  configMerkleRoot: FieldOperation;
  newVerificationKey: FieldOperation;
  vaultDebtCeiling: UInt64Operation;
};

/**
 * The main class. We only store the final fields, but we provide static
 * methods to create or merge them in a more flexible, minimal way.
 */
export class EngineUpdateOperation extends Struct({
  emergencyStop: BoolOperation,
  vaultCreationDisabled: BoolOperation,
  collateralRatio: UInt8Operation,
  validPriceBlockCount: UInt8Operation,
  liquidationBonusRatio: UInt8Operation,
  oracleWhitelistHash: FieldOperation,
  configMerkleRoot: FieldOperation,
  newVerificationKey: FieldOperation,
  vaultDebtCeiling: UInt64Operation,
}) {
  /**
   * Creates a new operation from a partial set of fields,
   * filling missing fields with no-ops.
   */
  static create(
    partial: Partial<EngineUpdateOperationFields>
  ): EngineUpdateOperation {
    // Fill in no-ops for missing fields
    const filled = {
      emergencyStop: partial.emergencyStop ?? BoolOperation.noop(),
      vaultCreationDisabled:
        partial.vaultCreationDisabled ?? BoolOperation.noop(),
      collateralRatio: partial.collateralRatio ?? UInt8Operation.noop(),
      validPriceBlockCount:
        partial.validPriceBlockCount ?? UInt8Operation.noop(),
      liquidationBonusRatio:
        partial.liquidationBonusRatio ?? UInt8Operation.noop(),
      oracleWhitelistHash: partial.oracleWhitelistHash ?? FieldOperation.noop(),
      configMerkleRoot: partial.configMerkleRoot ?? FieldOperation.noop(),
      newVerificationKey: partial.newVerificationKey ?? FieldOperation.noop(),
      vaultDebtCeiling: partial.vaultDebtCeiling ?? UInt64Operation.noop(),
    };
    return new EngineUpdateOperation(filled);
  }

  static noop(): EngineUpdateOperation {
    return EngineUpdateOperation.create({});
  }

  toFields(): Field[] {
    return [
      ...this.emergencyStop.toFields(),
      ...this.vaultCreationDisabled.toFields(),
      ...this.collateralRatio.toFields(),
      ...this.validPriceBlockCount.toFields(),
      ...this.liquidationBonusRatio.toFields(),
      ...this.oracleWhitelistHash.toFields(),
      ...this.configMerkleRoot.toFields(),
      ...this.newVerificationKey.toFields(),
      ...this.vaultDebtCeiling.toFields(),
      ...this.vaultCreationDisabled.toFields(),
    ];
  }
}

export function prettyPrintOperation(operation: EngineUpdateOperation): string {
  // use printOperation from simple-operations.ts
  // make a list of no noop operations
  const operations = {
    emergencyStop: operation.emergencyStop,
    vaultCreationDisabled: operation.vaultCreationDisabled,
    collateralRatio: operation.collateralRatio,
    validPriceBlockCount: operation.validPriceBlockCount,
    liquidationBonusRatio: operation.liquidationBonusRatio,
    oracleWhitelistHash: operation.oracleWhitelistHash,
    configMerkleRoot: operation.configMerkleRoot,
    newVerificationKey: operation.newVerificationKey,
    vaultDebtCeiling: operation.vaultDebtCeiling,
  };
  // display both key and value for each operation  
  const nonNoopOperations = Object.entries(operations).filter(([_, op]) => !op.isNoop().toBoolean());
  const operLines = nonNoopOperations.map(([key, op]) => `- ${key}: ${printOperation(op)}`).join("\n");
  return `EngineUpdateOperation:\n${operLines}`;
}
  
