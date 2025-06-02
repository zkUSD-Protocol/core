import {
  BlockStateCommitment,
  NextBlockStateCandidate,
  StateRoots,
  SystemParams,
} from '../../validator/block-state.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
import {
  BlockBlob,
  MapType,
  Operation,
  OperationType,
  BlobType,
  BlockData,
  BlockMetadata,
  BlockHeader,
} from '../types/types.js';
import { BaseBlobBuilder } from './base-blob-builder.js';

interface BuildBlockBlobArgs {
  readonly previousBlockBlob: BlockBlob;
  readonly previousStateRoots: StateRoots;
  readonly previousBlockBlobId: string;
  readonly nextStateValidatedIntentOperations: IntentMapOperation[];
  readonly nextStateRoots: StateRoots;
  readonly checkpointBlobId?: string;
  readonly checkpointBlock?: number;
}

interface BuildGenesisBlockBlobArgs {
  readonly initialStateRoots: StateRoots;
}

export class BlockBlobBuilder extends BaseBlobBuilder<BlockBlob> {
  static buildBlockBlob(args: BuildBlockBlobArgs): BlockBlob {
    return new BlockBlobBuilder()
      .withPreviousBlock(args.previousBlockBlob, args.previousBlockBlobId)
      .withNextBlockState(
        args.nextStateValidatedIntentOperations,
        args.nextStateRoots
      )
      .withCheckpoint(args.checkpointBlobId, args.checkpointBlock)
      .build();
  }

  static buildGenesisBlockBlob(args: BuildGenesisBlockBlobArgs): BlockBlob {
    return new BlockBlobBuilder()
      .withGenesisBlock(args.initialStateRoots)
      .build();
  }

  withGenesisBlock(initialStateRoots: StateRoots): this {
    this.initializeBlob(BlobType.BLOCK, '1.0.0');

    const blockData: BlockData = {
      block: 0,
      vaultMapRoot: initialStateRoots.vaultMapRoot.toString(),
      zkUsdMapRoot: initialStateRoots.zkUsdMapRoot.toString(),
      operations: [],
      operationCount: 0,
    };

    const metadata: BlockMetadata = {
      checkpointBlobId: '',
      checkpointBlock: -1,
      sinceCheckpointBlockHeaders: [],
    };

    this.file = {
      ...this.file,
      blockData,
      blockMetadata: metadata,
    };
    return this;
  }

  withPreviousBlock(previousBlob: BlockBlob, blobId: string): this {
    this.initializeBlob(BlobType.BLOCK, previousBlob.version);

    const blockMetaData: BlockMetadata = previousBlob.blockMetadata;

    const previousBlockHeader: BlockHeader = {
      block: previousBlob.blockData.block,
      vaultMapRoot: previousBlob.blockData.vaultMapRoot,
      zkUsdMapRoot: previousBlob.blockData.zkUsdMapRoot,
      operationCount: previousBlob.blockData.operationCount,
      blockBlobId: blobId,
    };

    blockMetaData.sinceCheckpointBlockHeaders.push(previousBlockHeader);

    this.file = {
      ...this.file,
      blockData: {
        block: previousBlob.blockData.block + 1,
        vaultMapRoot: '',
        zkUsdMapRoot: '',
        operations: [],
        operationCount: 0,
      },
      blockMetadata: blockMetaData,
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
      blockData: {
        block: this.file.blockData!.block,
        vaultMapRoot: nextStateRoots.vaultMapRoot.toString(),
        zkUsdMapRoot: nextStateRoots.zkUsdMapRoot.toString(),
        operations,
        operationCount: operations.length,
      },
    };
    return this;
  }

  withCheckpoint(
    checkpointBlobId: string | undefined,
    checkpointBlock: number | undefined
  ): this {
    if (checkpointBlobId && checkpointBlock) {
      //if we have a checkpoint block then we can remove the previous checkpoint block headers
      const blockMetaData = this.file.blockMetadata!;
      blockMetaData.sinceCheckpointBlockHeaders =
        blockMetaData.sinceCheckpointBlockHeaders.filter(
          (block) => block.block > checkpointBlock
        );

      this.file = {
        ...this.file,
        blockMetadata: {
          ...this.file.blockMetadata!,
          checkpointBlobId,
          checkpointBlock,
        },
      };
    }
    return this;
  }

  protected getRequiredFields(): string[] {
    return ['version', 'blobType', 'blockData', 'blockMetadata'];
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
