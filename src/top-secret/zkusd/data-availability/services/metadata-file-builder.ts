import { StateRoots } from '../../validator/block-state.js';
import {
  BlockFile,
  MetadataFile,
  FileType,
  BlockMetadata,
} from '../types/types.js';
import { BaseFileBuilder } from './base-file-builder.js';
import { Field, Poseidon } from 'o1js';

interface BuildMetadataFileArgs {
  readonly previousMetadataFile: MetadataFile;
  readonly newBlockFile: BlockFile;
  readonly newBlockBlobId: string;
  readonly checkpointBlobId?: string;
  readonly checkpointBlock?: number;
}

interface BuildGenesisMetadataFileArgs {
  readonly genesisBlockFile: BlockFile;
  readonly genesisBlockBlobId: string;
}

export class MetadataFileBuilder extends BaseFileBuilder<MetadataFile> {
  static buildMetadataFile(args: BuildMetadataFileArgs): MetadataFile {
    return new MetadataFileBuilder()
      .withPreviousMetadata(args.previousMetadataFile)
      .withNewBlock(args.newBlockFile, args.newBlockBlobId)
      .withCheckpoint(args.checkpointBlobId, args.checkpointBlock)
      .build();
  }

  static buildGenesisMetadataFile(
    args: BuildGenesisMetadataFileArgs
  ): MetadataFile {
    return new MetadataFileBuilder()
      .withGenesisMetadata(args.genesisBlockFile, args.genesisBlockBlobId)
      .build();
  }

  withGenesisMetadata(
    genesisBlockFile: BlockFile,
    genesisBlockBlobId: string
  ): this {
    this.initializeFile(FileType.METADATA, '1.0.0');

    // Create genesis block metadata
    const genesisBlockMetadata: BlockMetadata = {
      block: genesisBlockFile.block,
      vaultMapRoot: genesisBlockFile.newVaultMapRoot,
      zkUsdMapRoot: genesisBlockFile.newZkUsdMapRoot,
      operationCount: genesisBlockFile.operationCount,
      blockBlobId: genesisBlockBlobId,
      blockHash: this.computeBlockHash(genesisBlockFile),
      previousBlockHash: '', // No previous block for genesis
    };

    this.file = {
      ...this.file,
      latestBlockFileBlobId: genesisBlockBlobId,
      latestBlock: genesisBlockFile.block,
      latestVaultMapRoot: genesisBlockFile.newVaultMapRoot,
      latestZkUsdMapRoot: genesisBlockFile.newZkUsdMapRoot,
      totalOperations: genesisBlockFile.operationCount,
      blocks: [genesisBlockMetadata],
      continuityProof: {
        blockRootChain: [genesisBlockMetadata.blockHash],
      },
    };
    return this;
  }

  withPreviousMetadata(previousMetadata: MetadataFile): this {
    this.initializeFile(FileType.METADATA, previousMetadata.version);

    this.file = {
      ...this.file,
      blocks: [...previousMetadata.blocks],
      continuityProof: {
        blockRootChain: [...previousMetadata.continuityProof.blockRootChain],
      },
      latestCheckpointFileBlobId: previousMetadata.latestCheckpointFileBlobId,
      latestCheckpointBlock: previousMetadata.latestCheckpointBlock,
    };
    return this;
  }

  withNewBlock(newBlockFile: BlockFile, newBlockBlobId: string): this {
    const blockMetadata: BlockMetadata = {
      block: newBlockFile.block,
      vaultMapRoot: newBlockFile.newVaultMapRoot,
      zkUsdMapRoot: newBlockFile.newZkUsdMapRoot,
      operationCount: newBlockFile.operationCount,
      blockBlobId: newBlockBlobId,
      blockHash: this.computeBlockHash(newBlockFile),
      previousBlockHash: this.getPreviousBlockHash(),
    };

    const updatedBlocks = [blockMetadata, ...(this.file.blocks || [])];
    const updatedRootChain = [
      blockMetadata.blockHash,
      ...(this.file.continuityProof?.blockRootChain || []),
    ];

    this.file = {
      ...this.file,
      latestBlockFileBlobId: newBlockBlobId,
      latestBlock: newBlockFile.block,
      latestVaultMapRoot: newBlockFile.newVaultMapRoot,
      latestZkUsdMapRoot: newBlockFile.newZkUsdMapRoot,
      totalOperations:
        (this.file.totalOperations || 0) + newBlockFile.operationCount,
      blocks: updatedBlocks,
      continuityProof: {
        blockRootChain: updatedRootChain,
      },
    };
    return this;
  }

  withCheckpoint(checkpointBlobId?: string, checkpointBlock?: number): this {
    if (checkpointBlobId) {
      this.file = {
        ...this.file,
        latestCheckpointFileBlobId: checkpointBlobId,
        latestCheckpointBlock: checkpointBlock,
      };
    }
    return this;
  }

  protected getRequiredFields(): string[] {
    return [
      'version',
      'fileType',
      'latestBlockFileBlobId',
      'latestBlock',
      'blocks',
    ];
  }

  private computeBlockHash(blockFile: BlockFile): string {
    const hashContent: Field[] = [
      Field(blockFile.block),
      Field(blockFile.newVaultMapRoot),
      Field(blockFile.newZkUsdMapRoot),
      Field(blockFile.operationCount),
    ];

    return Poseidon.hash(hashContent).toString();
  }

  private getPreviousBlockHash(): string {
    if (this.file.blocks && this.file.blocks.length > 0) {
      return this.file.blocks[0].blockHash;
    }
    return '';
  }
}
