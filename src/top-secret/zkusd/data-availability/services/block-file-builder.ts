import {
  BlockStateCommitment,
  NextStateCandidate,
  StateRoots,
  SystemParams,
} from '../../validator/block-state.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
import {
  BlockFile,
  MapType,
  Operation,
  OperationType,
  FileType,
} from '../types/types.js';
import { BaseFileBuilder } from './base-file-builder.js';

interface BuildBlockFileArgs {
  readonly previousBlockFile: BlockFile;
  readonly previousStateRoots: StateRoots;
  readonly previousBlockBlobId: string;
  readonly nextStateValidatedIntentOperations: IntentMapOperation[];
  readonly nextStateRoots: StateRoots;
}

interface BuildGenesisBlockFileArgs {
  readonly genesisStateRoots: StateRoots;
}

export class BlockFileBuilder extends BaseFileBuilder<BlockFile> {
  static buildBlockFile(args: BuildBlockFileArgs): BlockFile {
    return new BlockFileBuilder()
      .withPreviousBlock(args.previousBlockFile, args.previousBlockBlobId)
      .withNextBlockState(
        args.nextStateValidatedIntentOperations,
        args.nextStateRoots
      )
      .build();
  }

  static buildGenesisBlockFile(args: BuildGenesisBlockFileArgs): BlockFile {
    return new BlockFileBuilder()
      .withGenesisBlock(args.genesisStateRoots)
      .build();
  }

  withGenesisBlock(initialStateRoots: StateRoots): this {
    this.initializeFile(FileType.EPOCH, '1.0.0');

    this.file = {
      ...this.file,

      // Genesis block specifics
      previousBlock: -1, // Indicates no previous block
      previousBlockBlobId: '', // No previous block blob
      block: 0, // Genesis block

      // Initial state becomes both previous and new (no operations yet)
      previousVaultMapRoot: '0', // Genesis placeholder
      previousZkUsdMapRoot: '0', // Genesis placeholder
      newVaultMapRoot: initialStateRoots.vaultMapRoot.toString(),
      newZkUsdMapRoot: initialStateRoots.zkUsdMapRoot.toString(),

      // No operations in genesis block
      operations: [],
      operationCount: 0,
    };
    return this;
  }

  withPreviousBlock(previousFile: BlockFile, blobId: string): this {
    this.initializeFile(FileType.EPOCH, previousFile.version);

    this.file = {
      ...this.file,
      previousBlock: previousFile.block,
      previousBlockBlobId: blobId,
      block: previousFile.block + 1,

      // Copy previous "new" values to "previous" fields
      previousVaultMapRoot: previousFile.newVaultMapRoot,
      previousZkUsdMapRoot: previousFile.newZkUsdMapRoot,
    };
    return this;
  }

  withNextBlockState(
    nextStateValidatedIntentOperations: IntentMapOperation[],
    nextStateRoots: StateRoots
  ): this {
    if (
      !nextStateValidatedIntentOperations ||
      nextStateValidatedIntentOperations.length === 0
    ) {
      throw new Error('Block state must contain at least one operation');
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
    return ['version', 'fileType', 'block', 'operations'];
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
