import { VaultMap } from '../../data/maps/vault-map.js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { CheckpointBlob, BlobType, BlockData } from '../types/types.js';
import { BaseBlobBuilder } from './base-blob-builder.js';

interface BuildCheckpointBlobArgs {
  readonly vaultMap: VaultMap;
  readonly zkUsdMap: ZkUsdMap;
  readonly previousCheckpointBlob?: CheckpointBlob;
  readonly checkpointBlockHistory: BlockData[];
  readonly checkpointBlock: number;
}

export class CheckpointBlobBuilder extends BaseBlobBuilder<CheckpointBlob> {
  static buildCheckpointBlob(args: BuildCheckpointBlobArgs): CheckpointBlob {
    return new CheckpointBlobBuilder()
      .withMaps(args.vaultMap, args.zkUsdMap)
      .withPreviousCheckpointBlob(args.previousCheckpointBlob)
      .withCheckpointBlockDataHistory(args.checkpointBlockHistory)
      .withCheckpointBlock(args.checkpointBlock)
      .build();
  }

  withMaps(vaultMap: VaultMap, zkUsdMap: ZkUsdMap): this {
    this.initializeBlob(BlobType.CHECKPOINT, '1.0.0');

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

  withPreviousCheckpointBlob(previousCheckpointBlob?: CheckpointBlob): this {
    this.file = {
      ...this.file,
      blocks: previousCheckpointBlob ? previousCheckpointBlob.blocks : [],
    };
    return this;
  }
  withCheckpointBlockDataHistory(blockHistory: BlockData[]): this {
    this.file = {
      ...this.file,
      blocks: this.file.blocks!.concat(blockHistory),
    };
    return this;
  }

  withCheckpointBlock(checkpointBlock: number): this {
    this.file = {
      ...this.file,
      block: checkpointBlock,
    };
    return this;
  }

  protected getRequiredFields(): string[] {
    return [
      'version',
      'blobType',
      'vaultMapData',
      'zkUsdMapData',
      'vaultMapRoot',
      'zkUsdMapRoot',
      'block',
      'blocks',
    ];
  }

  // Static utility methods (keeping your existing functionality)
  static loadMapsFromCheckpoint(checkpoint: CheckpointBlob): {
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
  static getCheckpointMetadata(checkpoint: CheckpointBlob) {
    return {
      block: checkpoint.block,
      // checkpointId: checkpoint.checkpointId,
      vaultMapRoot: checkpoint.vaultMapRoot,
      zkUsdMapRoot: checkpoint.zkUsdMapRoot,
    };
  }
}
