import { StateRoots } from '../../validator/epoch-state.js';
import {
  EpochFile,
  MetadataFile,
  WalrusFileType,
  EpochMetadata,
} from '../types/types.js';
import { BaseFileBuilder } from './base-file-builder.js';
import { Field, Poseidon } from 'o1js';

interface BuildMetadataFileArgs {
  readonly previousMetadataFile: MetadataFile;
  readonly newEpochFile: EpochFile;
  readonly newEpochBlobId: string;
}

export class MetadataFileBuilder extends BaseFileBuilder<MetadataFile> {
  static buildMetadataFile(args: BuildMetadataFileArgs): MetadataFile {
    return new MetadataFileBuilder()
      .withPreviousMetadata(args.previousMetadataFile)
      .withNewEpoch(args.newEpochFile, args.newEpochBlobId)
      .build();
  }

  withPreviousMetadata(previousMetadata: MetadataFile): this {
    this.initializeFile(WalrusFileType.METADATA, previousMetadata.version);

    this.file = {
      ...this.file,
      // Copy existing network info and continuity proof
      epochs: [...previousMetadata.epochs], // Will be updated in withNewEpoch
      continuityProof: {
        epochRootChain: [...previousMetadata.continuityProof.epochRootChain],
      },
    };
    return this;
  }

  withNewEpoch(newEpochFile: EpochFile, newEpochBlobId: string): this {
    // Create epoch metadata for the new epoch
    const epochMetadata: EpochMetadata = {
      epoch: newEpochFile.epoch,
      vaultMapRoot: newEpochFile.newVaultMapRoot,
      zkUsdMapRoot: newEpochFile.newZkUsdMapRoot,
      timestamp: newEpochFile.timestamp,
      operationCount: newEpochFile.operationCount,
      epochBlobId: newEpochBlobId,
      epochHash: this.computeEpochHash(newEpochFile),
      previousEpochHash: this.getPreviousEpochHash(),
    };

    // Update epochs list (add new epoch at the beginning, keep most recent first)
    const updatedEpochs = [epochMetadata, ...(this.file.epochs || [])];

    // Update continuity proof with new epoch root
    const updatedRootChain = [
      epochMetadata.epochHash,
      ...(this.file.continuityProof?.epochRootChain || []),
    ];

    this.file = {
      ...this.file,
      latestEpochFileBlobId: newEpochBlobId,
      latestEpoch: newEpochFile.epoch,
      latestVaultMapRoot: newEpochFile.newVaultMapRoot,
      latestZkUsdMapRoot: newEpochFile.newZkUsdMapRoot,
      totalOperations:
        (this.file.totalOperations || 0) + newEpochFile.operationCount,
      epochs: updatedEpochs,
      continuityProof: {
        epochRootChain: updatedRootChain,
      },
    };
    return this;
  }

  protected getRequiredFields(): string[] {
    return [
      'version',
      'fileType',
      'timestamp',
      'latestEpochFileBlobId',
      'latestEpoch',
      'epochs',
    ];
  }

  private computeEpochHash(epochFile: EpochFile): string {
    // Create a deterministic hash of the epoch file content
    const hashContent: Field[] = [
      Field(epochFile.epoch),
      Field(epochFile.newVaultMapRoot),
      Field(epochFile.newZkUsdMapRoot),
      Field(epochFile.operationCount),
    ];

    return Poseidon.hash(hashContent).toString();
  }

  private getPreviousEpochHash(): string {
    if (this.file.epochs && this.file.epochs.length > 0) {
      return this.file.epochs[0].epochHash;
    }
    return ''; // Genesis epoch
  }
}
