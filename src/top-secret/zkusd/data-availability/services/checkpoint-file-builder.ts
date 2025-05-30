import { VaultMap } from '../../data/maps/vault-map.js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { CheckpointFile, FileType } from '../types/types.js';
import { BaseFileBuilder } from './base-file-builder.js';

interface BuildCheckpointFileArgs {
  readonly vaultMap: VaultMap;
  readonly zkUsdMap: ZkUsdMap;
  readonly block: number;
  readonly blockBlobId: string;
  readonly checkpointId: string;
}

export class CheckpointFileBuilder extends BaseFileBuilder<CheckpointFile> {
  static buildCheckpointFile(args: BuildCheckpointFileArgs): CheckpointFile {
    return new CheckpointFileBuilder()
      .withMaps(args.vaultMap, args.zkUsdMap)
      .withMetadata(args.block, args.checkpointId, args.blockBlobId)
      .build();
  }

  withMaps(vaultMap: VaultMap, zkUsdMap: ZkUsdMap): this {
    this.initializeFile(FileType.CHECKPOINT, '1.0.0');

    const vaultMapData = vaultMap.serialize();
    const zkUsdMapData = zkUsdMap.serialize();

    this.file = {
      ...this.file,
      vaultMapData,
      zkUsdMapData,
      vaultMapRoot: vaultMapData.root,
      zkUsdMapRoot: zkUsdMapData.root,
    };
    return this;
  }

  withMetadata(block: number, checkpointId: string, blockBlobId: string): this {
    this.file = {
      ...this.file,
      block,
      checkpointId,
      blockBlobId,
    };
    return this;
  }

  protected getRequiredFields(): string[] {
    return [
      'version',
      'fileType',
      'vaultMapData',
      'zkUsdMapData',
      'block',
      'blockBlobId',
      'checkpointId',
      'vaultMapRoot',
      'zkUsdMapRoot',
    ];
  }

  // Static utility methods (keeping your existing functionality)
  static loadMapsFromCheckpoint(checkpoint: CheckpointFile): {
    vaultMap: VaultMap;
    zkUsdMap: ZkUsdMap;
  } {
    // Direct access to raw JSON - no additional parsing needed
    const vaultMap = VaultMap.fromSerialized(checkpoint.vaultMapData);
    const zkUsdMap = ZkUsdMap.fromSerialized(checkpoint.zkUsdMapData);

    // Verify integrity
    if (vaultMap.root.toString() !== checkpoint.vaultMapRoot) {
      throw new Error('Vault map root mismatch');
    }

    if (zkUsdMap.root.toString() !== checkpoint.zkUsdMapRoot) {
      throw new Error('ZkUSD map root mismatch');
    }

    return { vaultMap, zkUsdMap };
  }

  // Quick metadata access without loading full maps
  static getCheckpointMetadata(checkpoint: CheckpointFile) {
    return {
      block: checkpoint.block,
      checkpointId: checkpoint.checkpointId,
      vaultMapRoot: checkpoint.vaultMapRoot,
      zkUsdMapRoot: checkpoint.zkUsdMapRoot,
    };
  }
}
