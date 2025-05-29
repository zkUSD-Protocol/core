import {
  EpochStateCommitment,
  NextEpochStateCandidate,
  StateRoots,
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
  readonly previousStateRoots: StateRoots;
  readonly previousEpochBlobId: string;
  readonly nextStateValidatedIntentOperations: IntentMapOperation[];
  readonly nextStateRoots: StateRoots;
}

export class EpochFileBuilder extends BaseFileBuilder<EpochFile> {
  static buildEpochFile(args: BuildEpochFileArgs): EpochFile {
    return new EpochFileBuilder()
      .withPreviousEpoch(args.previousEpochFile, args.previousEpochBlobId)
      .withNextEpochState(
        args.nextStateValidatedIntentOperations,
        args.nextStateRoots
      )
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
      previousZkUsdMapRoot: previousFile.newZkUsdMapRoot,
    };
    return this;
  }

  withNextEpochState(
    nextStateValidatedIntentOperations: IntentMapOperation[],
    nextStateRoots: StateRoots
  ): this {
    if (
      !nextStateValidatedIntentOperations ||
      nextStateValidatedIntentOperations.length === 0
    ) {
      throw new Error('Epoch state must contain at least one operation');
    }

    const operations = this.mapOperations(nextStateValidatedIntentOperations);

    this.file = {
      ...this.file,
      newVaultMapRoot: nextStateRoots.vaultMapRoot.toString(),
      newZkUsdMapRoot: nextStateRoots.zkUsdMapRoot.toString(),
      operations,
      operationCount: operations.length,
    };
    return this;
  }

  protected getRequiredFields(): string[] {
    return ['version', 'fileType', 'timestamp', 'epoch', 'operations'];
  }

  private mapOperations(mapOperations: IntentMapOperation[]): Operation[] {
    return mapOperations.map((op) => ({
      mapType: op.mapType as MapType,
      type: op.type as OperationType,
      key: op.key.toString(),
      value: op.value?.toString(),
    }));
  }
}
