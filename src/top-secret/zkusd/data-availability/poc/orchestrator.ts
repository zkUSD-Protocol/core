import { Field } from 'o1js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { Epoch } from './epoch.js';
import fs from 'fs';
import path from 'path';

const BATCH_SIZE = 50;
const TOTAL_OPERATIONS = 500;

export class Orchestrator {
  public zkUsdMap: ZkUsdMap;
  private totalOperations: ZkUsdMapOperation[] = [];
  private epochId: number = 0;
  private sequence: number = 0;
  private totalProcessedOperations: number = 0;
  private epochs: EpochMetadata[] = [];
  private epochRootChain: string[] = [];

  constructor() {
    this.zkUsdMap = new ZkUsdMap();
    this.epochId = 0;
    this.generateOperations();
  }

  public run() {
    // Check if files already exist for current configuration
    if (this.filesExistForCurrentConfig()) {
      console.log(
        '📁 Files already exist for current configuration, loading existing data...'
      );
      this.loadExistingData();
      return;
    }

    console.log('🚀 Starting orchestrator run...');
    this.writeMetadataChainFile();
    for (let i = 0; i < this.totalOperations.length; i += BATCH_SIZE) {
      const epochOperations = this.totalOperations.slice(i, i + BATCH_SIZE);
      const epoch = new Epoch(this.epochId, this.zkUsdMap);
      const epochMetadata = epoch.processEpoch(
        epochOperations,
        this.epochs[this.epochs.length - 1]?.epochHash ?? ''
      );
      this.epochId++;

      this.epochRootChain.push(this.zkUsdMap.root.toString());
      this.epochs.push(epochMetadata);
      this.totalProcessedOperations += epochOperations.length;

      this.writeMetadataChainFile();
    }
    console.log('✅ Orchestrator run completed');
  }

  /**
   * Check if all required files exist for the current BATCH_SIZE and TOTAL_OPERATIONS configuration
   */
  private filesExistForCurrentConfig(): boolean {
    const metadataPath = this.getMetadataPath();

    // Check if metadata file exists
    if (!fs.existsSync(metadataPath)) {
      return false;
    }

    try {
      // Read and validate metadata file
      const metadata: MetadataChainFile = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8')
      );

      // Check if the configuration matches
      if (metadata.totalOperations !== TOTAL_OPERATIONS) {
        console.log(
          `⚠️  Total operations mismatch: expected ${TOTAL_OPERATIONS}, found ${metadata.totalOperations}`
        );
        return false;
      }

      const expectedEpochs = Math.ceil(TOTAL_OPERATIONS / BATCH_SIZE);
      if (metadata.epochs.length !== expectedEpochs) {
        console.log(
          `⚠️  Epoch count mismatch: expected ${expectedEpochs}, found ${metadata.epochs.length}`
        );
        return false;
      }

      // Check if all epoch files exist
      for (let epochId = 0; epochId < expectedEpochs; epochId++) {
        const epochPath = this.getEpochPath(epochId);
        if (!fs.existsSync(epochPath)) {
          console.log(`⚠️  Missing epoch file: ${epochPath}`);
          return false;
        }

        // Validate epoch file structure
        try {
          const epochData: ZkUsdEpochFile = JSON.parse(
            fs.readFileSync(epochPath, 'utf-8')
          );
          const expectedOperationCount =
            epochId === expectedEpochs - 1
              ? TOTAL_OPERATIONS % BATCH_SIZE || BATCH_SIZE // Last epoch might have fewer operations
              : BATCH_SIZE;

          if (epochData.operations.length !== expectedOperationCount) {
            console.log(
              `⚠️  Epoch ${epochId} operation count mismatch: expected ${expectedOperationCount}, found ${epochData.operations.length}`
            );
            return false;
          }
        } catch (error) {
          console.log(`⚠️  Invalid epoch file ${epochId}: ${error}`);
          return false;
        }
      }

      console.log(
        `✅ All files exist and match configuration (${TOTAL_OPERATIONS} ops, ${BATCH_SIZE} batch size, ${expectedEpochs} epochs)`
      );
      return true;
    } catch (error) {
      console.log(`⚠️  Error reading metadata file: ${error}`);
      return false;
    }
  }

  /**
   * Load existing data from files instead of regenerating
   */
  private loadExistingData(): void {
    const metadataPath = this.getMetadataPath();
    const metadata: MetadataChainFile = JSON.parse(
      fs.readFileSync(metadataPath, 'utf-8')
    );

    // Restore orchestrator state from metadata
    this.epochId = metadata.latestEpoch;
    this.totalProcessedOperations = metadata.totalOperations;
    this.epochs = metadata.epochs;
    this.epochRootChain = metadata.continuityProof.epochRootChain;

    // Rebuild the ZkUsdMap from epoch files
    console.log('🔄 Rebuilding ZkUsdMap from epoch files...');
    this.rebuildMapFromEpochFiles();

    console.log(
      `📊 Loaded existing data: ${this.totalProcessedOperations} operations across ${this.epochs.length} epochs`
    );
    console.log(`🌳 Final root: ${this.zkUsdMap.root.toString()}`);
  }

  /**
   * Rebuild the ZkUsdMap by replaying all operations from epoch files
   */
  private rebuildMapFromEpochFiles(): void {
    // Reset the map
    this.zkUsdMap = new ZkUsdMap();

    // Process each epoch in order
    for (let epochId = 0; epochId < this.epochs.length; epochId++) {
      const epochPath = this.getEpochPath(epochId);
      const epochData: ZkUsdEpochFile = JSON.parse(
        fs.readFileSync(epochPath, 'utf-8')
      );

      // Apply all operations from this epoch
      for (const operation of epochData.operations) {
        this.zkUsdMap.insert(
          Field.from(operation.key),
          Field.from(operation.value!)
        );
      }
    }

    // Verify the final root matches
    const expectedRoot = this.epochs[this.epochs.length - 1]?.root;
    const actualRoot = this.zkUsdMap.root.toString();

    if (expectedRoot !== actualRoot) {
      throw new Error(
        `Root mismatch after rebuilding! Expected: ${expectedRoot}, Got: ${actualRoot}`
      );
    }
  }

  /**
   * Force regeneration of all files (useful for testing or when configuration changes)
   */
  public forceRegenerate(): void {
    console.log('🔄 Force regenerating all files...');
    this.cleanupExistingFiles();

    // Reset state
    this.zkUsdMap = new ZkUsdMap();
    this.epochId = 0;
    this.totalProcessedOperations = 0;
    this.epochs = [];
    this.epochRootChain = [];

    // Regenerate operations and run
    this.generateOperations();
    this.run();
  }

  /**
   * Clean up existing files for the current configuration
   */
  private cleanupExistingFiles(): void {
    const metadataPath = this.getMetadataPath();

    // Remove metadata file
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }

    // Remove all epoch files
    const expectedEpochs = Math.ceil(TOTAL_OPERATIONS / BATCH_SIZE);
    for (let epochId = 0; epochId < expectedEpochs; epochId++) {
      const epochPath = this.getEpochPath(epochId);
      if (fs.existsSync(epochPath)) {
        fs.unlinkSync(epochPath);
      }
    }

    console.log('🗑️  Cleaned up existing files');
  }

  /**
   * Get the path for the metadata file
   */
  private getMetadataPath(): string {
    return path.join(
      process.cwd(),
      '/src/top-secret/zkusd/data-availability/poc/da/zkusd_metadata.json'
    );
  }

  /**
   * Get the path for a specific epoch file
   */
  private getEpochPath(epochId: number): string {
    return path.join(
      process.cwd(),
      `/src/top-secret/zkusd/data-availability/poc/da/zkusd_tree_epoch_${epochId}.json`
    );
  }

  /**
   * Get current configuration info
   */
  public getConfigInfo(): {
    batchSize: number;
    totalOperations: number;
    expectedEpochs: number;
  } {
    return {
      batchSize: BATCH_SIZE,
      totalOperations: TOTAL_OPERATIONS,
      expectedEpochs: Math.ceil(TOTAL_OPERATIONS / BATCH_SIZE),
    };
  }

  private generateOperations() {
    for (let i = 0; i < TOTAL_OPERATIONS; i++) {
      const operation = this.generateOperation();
      this.totalOperations.push(operation);
    }
  }

  private generateOperation() {
    const operation: ZkUsdMapOperation = {
      type: OperationType.INSERT,
      sequence: this.sequence,
      key: Field.random().toString(),
      value: '1',
    };

    this.sequence++;

    return operation;
  }

  private writeMetadataChainFile() {
    //write the epoch file to the disk
    fs.writeFileSync(
      this.getMetadataPath(),
      JSON.stringify({
        latestEpoch: this.epochId,
        latestRoot: this.zkUsdMap.root.toString(),
        totalOperations: this.totalProcessedOperations,
        epochs: this.epochs,
        networkInfo: {
          chainId: '1',
          genesisRoot: this.zkUsdMap.root.toString(),
          genesisTimestamp: Date.now(),
        },
        continuityProof: {
          epochRootChain: this.epochRootChain,
        },
      })
    );
  }
}
