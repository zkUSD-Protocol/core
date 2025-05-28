import {
  EpochStateCommitment,
  IncrementalEpochState,
  IntentOperation,
  SystemParams,
} from '../../validator/epoch-state.js';
import {
  EpochFile,
  MapType,
  Operation,
  OperationType,
  WalrusFileType,
} from '../types/types.js';
import { BaseFileBuilder } from './base-file-builder.js';

interface BuildEpochFileArgs {
  readonly previousEpochFile: EpochFile;
  readonly epochState: IncrementalEpochState;
  readonly previousEpochBlobId: string;
}

export class EpochFileBuilder extends BaseFileBuilder<EpochFile> {
  static buildEpochFile(args: BuildEpochFileArgs): EpochFile {
    return new EpochFileBuilder()
      .withPreviousEpoch(args.previousEpochFile, args.previousEpochBlobId)
      .withEpochState(args.epochState)
      .build();
  }

  withPreviousEpoch(previousFile: EpochFile, blobId: string): this {
    this.initializeFile(WalrusFileType.EPOCH, previousFile.version);

    this.file = {
      ...this.file,
      previousEpoch: previousFile.epoch,
      previousEpochBlobId: blobId,
      epoch: previousFile.epoch + 1,

      // Copy previous "new" values to "previous" fields
      previousVaultMapRoot: previousFile.newVaultMapRoot,
      previousVaultMapLength: previousFile.newVaultMapLength,
      previousZkUsdMapRoot: previousFile.newZkUsdMapRoot,
      previousZkUsdMapLength: previousFile.newZkUsdMapLength,
      previousValidPriceBlockCount: previousFile.newValidPriceBlockCount,
      previousEmergencyStop: previousFile.newEmergencyStop,
      previousCollateralRatio: previousFile.newCollateralRatio,
      previousLiquidationBonusRatio: previousFile.newLiquidationBonusRatio,
      previousVaultDebtCeiling: previousFile.newVaultDebtCeiling,
      previousOraclesHash: previousFile.newOraclesHash,
    };
    return this;
  }

  withEpochState(epochState: IncrementalEpochState): this {
    if (
      !epochState.intentOperations ||
      epochState.intentOperations.length === 0
    ) {
      throw new Error('Epoch state must contain at least one operation');
    }

    this.validateSequencedOperations(epochState.intentOperations);

    const operations = this.mapOperations(epochState.intentOperations);
    const newState = this.mapStateCommitment(epochState.nextEpochState);
    const newParams = this.mapSystemParams(epochState.systemParams);

    this.file = {
      ...this.file,
      timestamp: epochState.timestamp,
      startSequence: operations[0].sequence,
      endSequence: operations[operations.length - 1].sequence,

      newVaultMapRoot: newState.vaultMapRoot,
      newVaultMapLength: newState.vaultMapLength,
      newZkUsdMapRoot: newState.zkUsdMapRoot,
      newZkUsdMapLength: newState.zkUsdMapLength,

      newValidPriceBlockCount: newParams.validPriceBlockCount,
      newEmergencyStop: newParams.emergencyStop,
      newCollateralRatio: newParams.collateralRatio,
      newLiquidationBonusRatio: newParams.liquidationBonusRatio,
      newVaultDebtCeiling: newParams.vaultDebtCeiling,
      newOraclesHash: newParams.oraclesHash,

      operations,
      operationCount: operations.length,
    };
    return this;
  }

  protected getRequiredFields(): string[] {
    return ['version', 'fileType', 'timestamp', 'epoch', 'operations'];
  }

  private validateSequencedOperations(
    intentOperations: IntentOperation[]
  ): void {
    if (intentOperations.length === 0) {
      throw new Error('Cannot validate empty operations array');
    }

    // Validate that operations are already sorted by sequence
    for (let i = 1; i < intentOperations.length; i++) {
      if (intentOperations[i].sequence <= intentOperations[i - 1].sequence) {
        throw new Error(
          `Operations are not properly sorted: sequence ${intentOperations[i].sequence} should be greater than ${intentOperations[i - 1].sequence} at index ${i}`
        );
      }
    }

    // Validate consecutive sequences (no gaps)
    for (let i = 1; i < intentOperations.length; i++) {
      const expectedSequence = intentOperations[i - 1].sequence + 1;
      if (intentOperations[i].sequence !== expectedSequence) {
        throw new Error(
          `Gap in sequence: expected ${expectedSequence}, got ${intentOperations[i].sequence}`
        );
      }
    }
  }

  private mapSystemParams(params: SystemParams) {
    return {
      validPriceBlockCount: params.validPriceBlockCount.toNumber(),
      emergencyStop: params.emergencyStop.toBoolean(),
      collateralRatio: params.collateralRatio.toNumber(),
      liquidationBonusRatio: params.liquidationBonusRatio.toNumber(),
      vaultDebtCeiling: params.vaultDebtCeiling.toBigInt(),
      oraclesHash: params.oraclesHash.toString(),
    };
  }

  private mapOperations(intentOperations: IntentOperation[]): Operation[] {
    return intentOperations.map((op) => ({
      sequence: op.sequence,
      mapType: op.mapOperation.mapType as MapType,
      type: op.mapOperation.type as OperationType,
      key: op.mapOperation.key.toString(),
      value: op.mapOperation.value?.toString(),
    }));
  }

  private mapStateCommitment(commitment: EpochStateCommitment) {
    return {
      vaultMapRoot: commitment.roots.vaultMapRoot.toString(),
      vaultMapLength: commitment.lengths.vaultMapLength.toString(),
      zkUsdMapRoot: commitment.roots.zkUsdMapRoot.toString(),
      zkUsdMapLength: commitment.lengths.zkUsdMapLength.toString(),
    };
  }
}
