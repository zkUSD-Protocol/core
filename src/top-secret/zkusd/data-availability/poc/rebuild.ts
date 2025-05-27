import { Field } from 'o1js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import fs from 'fs';
import path from 'path';

export class Rebuild {
  private zkUsdMap: ZkUsdMap;

  constructor() {
    this.zkUsdMap = new ZkUsdMap();
  }

  public rebuildFromFiles(): { zkUsdMap: ZkUsdMap; finalRoot: string } {
    // Read the metadata file
    const metadataPath = path.join(
      process.cwd(),
      '/src/top-secret/zkusd/data-availability/poc/da/zkusd_metadata.json'
    );

    if (!fs.existsSync(metadataPath)) {
      throw new Error('Metadata file not found');
    }

    const metadata: MetadataChainFile = JSON.parse(
      fs.readFileSync(metadataPath, 'utf-8')
    );

    // Sort epochs by epoch number to ensure correct order
    const sortedEpochs = metadata.epochs.sort((a, b) => a.epoch - b.epoch);

    // Rebuild the tree by processing each epoch in order
    for (const epochMetadata of sortedEpochs) {
      this.processEpochFile(epochMetadata.epoch);
    }

    return {
      zkUsdMap: this.zkUsdMap,
      finalRoot: this.zkUsdMap.root.toString(),
    };
  }

  private processEpochFile(epochNumber: number): void {
    const epochFilePath = path.join(
      process.cwd(),
      `/src/top-secret/zkusd/data-availability/poc/da/zkusd_tree_epoch_${epochNumber}.json`
    );

    if (!fs.existsSync(epochFilePath)) {
      throw new Error(
        `Epoch file not found: zkusd_tree_epoch_${epochNumber}.json`
      );
    }

    const epochData: ZkUsdEpochFile = JSON.parse(
      fs.readFileSync(epochFilePath, 'utf-8')
    );

    // Apply all operations in this epoch
    for (const operation of epochData.operations) {
      this.applyOperation(operation);
    }
  }

  private applyOperation(operation: Operation): void {
    if (operation.type === 'insert') {
      this.zkUsdMap.insert(
        Field.from(operation.key),
        Field.from(operation.value!)
      );
    } else if (operation.type === 'update') {
      // For updates, we would need to implement update logic
      // Since the current implementation only uses inserts, we'll handle it as an insert
      this.zkUsdMap.insert(
        Field.from(operation.key),
        Field.from(operation.newValue!)
      );
    }
  }

  public getRoot(): string {
    return this.zkUsdMap.root.toString();
  }

  public getLength(): string {
    return this.zkUsdMap.length.toString();
  }
}
