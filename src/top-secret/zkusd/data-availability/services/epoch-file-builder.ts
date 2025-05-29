import {
  EpochStateCommitment,
  NextEpochStateCandidate,
  SystemParams,
} from '../../validator/epoch-state.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
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
  readonly epochState: NextEpochStateCandidate;
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

  withEpochState(epochState: NextEpochStateCandidate): this {
    if (!epochState.mapOperations || epochState.mapOperations.length === 0) {
      throw new Error('Epoch state must contain at least one operation');
    }

    const operations = this.mapOperations(epochState.mapOperations);
    const newState = this.mapStateCommitment(epochState.nextEpochState);
    const newParams = this.mapSystemParams(epochState.systemParams);

    this.file = {
      ...this.file,
      timestamp: epochState.timestamp,
      startIntentSequence: epochState.startIntentSequence,
      endIntentSequence: epochState.endIntentSequence,

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

  private mapOperations(mapOperations: IntentMapOperation[]): Operation[] {
    return mapOperations.map((op) => ({
      mapType: op.mapType as MapType,
      type: op.type as OperationType,
      key: op.key.toString(),
      value: op.value?.toString(),
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
