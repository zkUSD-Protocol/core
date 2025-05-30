import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { performance } from 'perf_hooks';
import { VaultMap } from '../data/maps/vault-map.js';
import { ZkUsdMap } from '../data/maps/zkusd-map.js';
import { Bool, Field, UInt64, UInt8 } from 'o1js';
import { DataAvailClient } from './client.js';
import { FullState, SystemParams } from '../validator/block-state.js';
import { InMemoryStateProxy } from '../validator/local-block-state.js';
import { CheckpointFileBuilder } from './services/checkpoint-file-builder.js';

interface BenchmarkResult {
  recordCount: number;
  mapCreationTimeMs: number;
  serializationTimeMs: number;
  deserializationTimeMs: number;
  checkpointCreationTimeMs: number;
  checkpointRestorationTimeMs: number;
  serializedSizeBytes: number;
  mapMemoryMB: number;
  processMemoryDeltaMB: number;
  estimatedMemoryPerRecordBytes: number;
}

interface PerformanceMetrics {
  operation: string;
  timeMs: number;
  sizeBytes?: number;
  recordCount: number;
}

interface NetworkEstimates {
  broadbandDownloadSec: number;
  broadbandUploadSec: number;
  fastBroadbandDownloadSec: number;
  fastBroadbandUploadSec: number;
  enterpriseTransferSec: number;
}

class BenchmarkSuite {
  private client: DataAvailClient;
  private systemParams: SystemParams;

  constructor() {
    this.client = DataAvailClient.withLocal({
      baseDir: './src/top-secret/zkusd/data-availability/benchmark-data',
      checkpointInterval: 1000,
    });

    this.systemParams = {
      validPriceBlockCount: UInt8.from(10),
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(150),
      liquidationBonusRatio: UInt8.from(100),
      vaultDebtCeiling: UInt64.from(1_000_000e9),
      oraclesHash: Field.from(0),
    };
  }

  async setup(): Promise<void> {
    await this.client.storageProvider.cleanup!();
  }

  /**
   * Create a ZkUSD map with the specified number of records
   */
  createPopulatedZkUsdMap(recordCount: number): ZkUsdMap {
    const map = new ZkUsdMap();

    console.log(`Creating ZkUSD map with ${recordCount} records...`);
    const start = performance.now();

    for (let i = 1; i <= recordCount; i++) {
      const key = Field(i);
      const value = Field(1); // Note commitments are typically just presence markers
      map.insert(key, value);

      // Progress indicator for large datasets
      if (i % 10000 === 0) {
        console.log(`  Inserted ${i} records...`);
      }
    }

    const end = performance.now();
    console.log(`Map creation took ${(end - start).toFixed(2)}ms`);

    return map;
  }

  /**
   * Create a vault map with a smaller number of records (vaults are less common)
   */
  createPopulatedVaultMap(recordCount: number): VaultMap {
    const map = new VaultMap();
    const vaultRecords = Math.min(recordCount / 10, 1000); // Vault map is much smaller

    for (let i = 1; i <= vaultRecords; i++) {
      const key = Field(i);
      const value = Field.random(); // Vault data is more complex
      map.insert(key, value);
    }

    return map;
  }

  /**
   * Measure serialization performance
   */
  measureSerialization(map: ZkUsdMap, recordCount: number): PerformanceMetrics {
    const start = performance.now();
    const serialized = map.serialize();
    const end = performance.now();

    const serializedString = JSON.stringify(serialized);
    const sizeBytes = Buffer.byteLength(serializedString, 'utf8');

    return {
      operation: 'serialization',
      timeMs: end - start,
      sizeBytes,
      recordCount,
    };
  }

  /**
   * Measure deserialization performance
   */
  measureDeserialization(
    serializedData: any,
    recordCount: number
  ): PerformanceMetrics {
    const start = performance.now();
    const map = ZkUsdMap.fromSerialized(serializedData);
    const end = performance.now();

    return {
      operation: 'deserialization',
      timeMs: end - start,
      recordCount,
    };
  }

  /**
   * Measure full checkpoint creation performance
   */
  async measureCheckpointCreation(
    state: FullState,
    recordCount: number
  ): Promise<PerformanceMetrics> {
    const start = performance.now();

    const checkpointFile = CheckpointFileBuilder.buildCheckpointFile({
      vaultMap: state.vaultMap,
      zkUsdMap: state.zkUsdMap,
      block: 1,
      blockBlobId: 'test-block-blob',
      checkpointId: `benchmark-${recordCount}`,
    });

    const serializedCheckpoint = JSON.stringify(checkpointFile);
    const end = performance.now();

    const sizeBytes = Buffer.byteLength(serializedCheckpoint, 'utf8');

    return {
      operation: 'checkpoint-creation',
      timeMs: end - start,
      sizeBytes,
      recordCount,
    };
  }

  /**
   * Measure checkpoint restoration performance
   */
  async measureCheckpointRestoration(
    checkpointData: any,
    recordCount: number
  ): Promise<PerformanceMetrics> {
    const start = performance.now();

    // Restore maps from checkpoint
    const vaultMap = VaultMap.fromSerialized(checkpointData.vaultMapData);
    const zkUsdMap = ZkUsdMap.fromSerialized(checkpointData.zkUsdMapData);

    // Create full state
    const restoredState = new FullState(this.systemParams, vaultMap, zkUsdMap);

    const end = performance.now();

    return {
      operation: 'checkpoint-restoration',
      timeMs: end - start,
      recordCount,
    };
  }

  /**
   * Force garbage collection and get stable memory reading
   */
  private async getStableMemoryUsage(): Promise<number> {
    // Force GC multiple times if available
    if (global.gc) {
      global.gc();
      global.gc(); // Run twice to be thorough
    }

    // Wait a bit for GC to complete
    return new Promise<number>((resolve) => {
      setTimeout(() => {
        // Take multiple measurements and use the minimum (most stable)
        const measurements = [];
        for (let i = 0; i < 5; i++) {
          measurements.push(process.memoryUsage().heapUsed);
        }

        // Use minimum to avoid GC timing issues
        const stableMemory = Math.min(...measurements);
        resolve(stableMemory / (1024 * 1024)); // Convert to MB
      }, 100);
    });
  }

  /**
   * Estimate actual object memory usage by analyzing the map structure
   */
  private estimateMapMemoryUsage(map: ZkUsdMap): number {
    const data = map.data.get();
    let estimatedBytes = 0;

    // Estimate nodes memory
    for (const level of data.nodes) {
      for (const node of level) {
        if (node !== undefined) {
          estimatedBytes += 32; // Each field is ~32 bytes
        }
      }
    }

    // Estimate sorted leaves memory
    estimatedBytes += data.sortedLeaves.length * (32 * 4); // 4 fields per leaf

    // Add overhead for data structures (arrays, objects)
    estimatedBytes += data.nodes.length * 64; // Array overhead per level
    estimatedBytes += data.sortedLeaves.length * 16; // Object overhead per leaf

    return estimatedBytes;
  }

  /**
   * Calculate network transfer times for different connection speeds
   */
  private calculateNetworkEstimates(sizeBytes: number): NetworkEstimates {
    const sizeBits = sizeBytes * 8;

    // Connection speeds in bits per second
    const broadbandDown = 50 * 1000 * 1000; // 50 Mbps
    const broadbandUp = 10 * 1000 * 1000; // 10 Mbps
    const fastBroadbandDown = 100 * 1000 * 1000; // 100 Mbps
    const fastBroadbandUp = 20 * 1000 * 1000; // 20 Mbps
    const enterprise = 1000 * 1000 * 1000; // 1 Gbps

    return {
      broadbandDownloadSec: sizeBits / broadbandDown,
      broadbandUploadSec: sizeBits / broadbandUp,
      fastBroadbandDownloadSec: sizeBits / fastBroadbandDown,
      fastBroadbandUploadSec: sizeBits / fastBroadbandUp,
      enterpriseTransferSec: sizeBits / enterprise,
    };
  }

  /**
   * Create a ZkUSD map with the specified number of records and measure creation time
   */
  createPopulatedZkUsdMapWithTiming(recordCount: number): {
    map: ZkUsdMap;
    creationTimeMs: number;
  } {
    const map = new ZkUsdMap();

    console.log(`Creating ZkUSD map with ${recordCount} records...`);
    const start = performance.now();

    for (let i = 1; i <= recordCount; i++) {
      const key = Field(i);
      const value = Field(1); // Note commitments are typically just presence markers
      map.insert(key, value);

      // Progress indicator for large datasets
      if (i % 10000 === 0) {
        console.log(`  Inserted ${i} records...`);
      }
    }

    const end = performance.now();
    const creationTimeMs = end - start;
    console.log(`Map creation took ${creationTimeMs.toFixed(2)}ms`);

    return { map, creationTimeMs };
  }

  /**
   * More comprehensive memory measurement
   */
  private async measureMemoryAccurately(recordCount: number): Promise<{
    mapMemoryMB: number;
    processMemoryDeltaMB: number;
    estimatedMemoryPerRecordBytes: number;
    mapCreationTimeMs: number;
  }> {
    // Get baseline memory
    const memoryBefore = await this.getStableMemoryUsage();

    // Create the map and measure creation time
    const { map: zkUsdMap, creationTimeMs } =
      this.createPopulatedZkUsdMapWithTiming(recordCount);

    // Get memory after map creation
    const memoryAfter = await this.getStableMemoryUsage();

    // Estimate actual map memory usage
    const estimatedMapBytes = this.estimateMapMemoryUsage(zkUsdMap);

    // Calculate metrics
    const processMemoryDeltaMB = Math.max(0, memoryAfter - memoryBefore);
    const mapMemoryMB = estimatedMapBytes / (1024 * 1024);
    const estimatedMemoryPerRecordBytes = estimatedMapBytes / recordCount;

    return {
      mapMemoryMB,
      processMemoryDeltaMB,
      estimatedMemoryPerRecordBytes,
      mapCreationTimeMs: creationTimeMs,
    };
  }

  /**
   * Run complete benchmark with accurate memory measurement
   */
  async runBenchmark(recordCount: number): Promise<BenchmarkResult> {
    console.log(`\n🔄 Running benchmark for ${recordCount} records...`);

    // === MEMORY MEASUREMENT (includes map creation time) ===
    const memoryMetrics = await this.measureMemoryAccurately(recordCount);

    // === PERFORMANCE MEASUREMENTS ===
    // Create fresh map for performance tests (memory already measured)
    const { map: zkUsdMap } =
      this.createPopulatedZkUsdMapWithTiming(recordCount);
    const vaultMap = this.createPopulatedVaultMap(recordCount);
    const state = new FullState(this.systemParams, vaultMap, zkUsdMap);

    // Measure serialization
    const serializationMetrics = this.measureSerialization(
      zkUsdMap,
      recordCount
    );

    // Measure deserialization
    const serializedData = zkUsdMap.serialize();
    const deserializationMetrics = this.measureDeserialization(
      serializedData,
      recordCount
    );

    // Measure checkpoint operations
    const checkpointCreationMetrics = await this.measureCheckpointCreation(
      state,
      recordCount
    );
    const checkpointFile = CheckpointFileBuilder.buildCheckpointFile({
      vaultMap: state.vaultMap,
      zkUsdMap: state.zkUsdMap,
      block: 1,
      blockBlobId: 'test-block-blob',
      checkpointId: `benchmark-${recordCount}`,
    });
    const checkpointRestorationMetrics =
      await this.measureCheckpointRestoration(checkpointFile, recordCount);

    return {
      recordCount,
      mapCreationTimeMs: memoryMetrics.mapCreationTimeMs,
      serializationTimeMs: serializationMetrics.timeMs,
      deserializationTimeMs: deserializationMetrics.timeMs,
      checkpointCreationTimeMs: checkpointCreationMetrics.timeMs,
      checkpointRestorationTimeMs: checkpointRestorationMetrics.timeMs,
      serializedSizeBytes: serializationMetrics.sizeBytes || 0,
      mapMemoryMB: memoryMetrics.mapMemoryMB,
      processMemoryDeltaMB: memoryMetrics.processMemoryDeltaMB,
      estimatedMemoryPerRecordBytes:
        memoryMetrics.estimatedMemoryPerRecordBytes,
    };
  }

  /**
   * Calculate linear growth with comprehensive analysis including network estimates
   */
  calculateLinearGrowth(
    result100: BenchmarkResult,
    result1000: BenchmarkResult
  ): void {
    const recordRatio = result1000.recordCount / result100.recordCount; // Should be 10

    console.log(`\n📊 LINEAR GROWTH ANALYSIS`);
    console.log(`Record ratio: ${recordRatio}x`);

    // Updated metrics including map creation time
    const metrics = [
      {
        name: 'Map Creation Time',
        value100: result100.mapCreationTimeMs,
        value1000: result1000.mapCreationTimeMs,
        unit: 'ms',
      },
      {
        name: 'Serialization Time',
        value100: result100.serializationTimeMs,
        value1000: result1000.serializationTimeMs,
        unit: 'ms',
      },
      {
        name: 'Deserialization Time',
        value100: result100.deserializationTimeMs,
        value1000: result1000.deserializationTimeMs,
        unit: 'ms',
      },
      {
        name: 'Checkpoint Creation',
        value100: result100.checkpointCreationTimeMs,
        value1000: result1000.checkpointCreationTimeMs,
        unit: 'ms',
      },
      {
        name: 'Checkpoint Restoration',
        value100: result100.checkpointRestorationTimeMs,
        value1000: result1000.checkpointRestorationTimeMs,
        unit: 'ms',
      },
      {
        name: 'Serialized Size',
        value100: result100.serializedSizeBytes,
        value1000: result1000.serializedSizeBytes,
        unit: 'bytes',
      },
      {
        name: 'Estimated Map Memory',
        value100: result100.mapMemoryMB * 1024 * 1024,
        value1000: result1000.mapMemoryMB * 1024 * 1024,
        unit: 'bytes',
      },
    ];

    console.log(`\nMetric Analysis:`);
    metrics.forEach((metric) => {
      const actualRatio = metric.value1000 / metric.value100;
      const linearityScore = actualRatio / recordRatio;
      const isLinear = linearityScore >= 0.8 && linearityScore <= 1.2;

      console.log(`  ${metric.name}:`);
      console.log(
        `    100 records: ${this.formatSize(metric.value100, metric.unit)}`
      );
      console.log(
        `    1000 records: ${this.formatSize(metric.value1000, metric.unit)}`
      );
      console.log(`    Growth ratio: ${actualRatio.toFixed(2)}x`);
      console.log(
        `    Linearity: ${(linearityScore * 100).toFixed(1)}% ${isLinear ? '✅' : '❌'}`
      );
    });

    // Performance per record analysis - FIXED CALCULATIONS
    console.log(`\n📊 PER-RECORD PERFORMANCE (based on 1000 records):`);
    const mapCreationPerRecord = result1000.mapCreationTimeMs / 1000;
    const serializationPerRecord = result1000.serializationTimeMs / 1000;
    const deserializationPerRecord = result1000.deserializationTimeMs / 1000;
    const storagePerRecord = result1000.serializedSizeBytes / 1000;
    const memoryPerRecord = result1000.estimatedMemoryPerRecordBytes;

    console.log(
      `  Map creation: ${mapCreationPerRecord.toFixed(3)}ms per record`
    );
    console.log(
      `  Serialization: ${serializationPerRecord.toFixed(3)}ms per record`
    );
    console.log(
      `  Deserialization: ${deserializationPerRecord.toFixed(3)}ms per record`
    );
    console.log(`  Storage: ${storagePerRecord.toFixed(0)} bytes per record`);
    console.log(`  Memory: ${memoryPerRecord.toFixed(0)} bytes per record`);

    // Extrapolation with network estimates - FIXED CALCULATIONS
    console.log(`\n🔮 EXTRAPOLATED PERFORMANCE & NETWORK ESTIMATES:`);

    const memoryPerRecord100 = result100.estimatedMemoryPerRecordBytes;
    const memoryPerRecord1000 = result1000.estimatedMemoryPerRecordBytes;
    const avgMemoryPerRecord = (memoryPerRecord100 + memoryPerRecord1000) / 2;

    const scales = [10000, 100000, 1000000, 10000000];
    scales.forEach((scale) => {
      console.log(`\n  At ${scale.toLocaleString()} records:`);

      // CORRECTED: Calculate time projections properly
      // All times are in milliseconds, so we divide by 1000 to get per-record, then multiply by scale
      const projectedMapCreationMs = mapCreationPerRecord * scale;
      const projectedSerializationMs = serializationPerRecord * scale;
      const projectedDeserializationMs = deserializationPerRecord * scale;

      // Convert to seconds for formatTime function
      const projectedMapCreationSec = projectedMapCreationMs / 1000;
      const projectedSerializationSec = projectedSerializationMs / 1000;
      const projectedDeserializationSec = projectedDeserializationMs / 1000;

      console.log(
        `    Map creation: ${this.formatTime(projectedMapCreationSec)}`
      );
      console.log(
        `    Serialization: ${this.formatTime(projectedSerializationSec)}`
      );
      console.log(
        `    Deserialization: ${this.formatTime(projectedDeserializationSec)}`
      );

      // Memory projections
      const projectedMemory = avgMemoryPerRecord * scale;
      console.log(
        `    Map memory: ${this.formatSize(projectedMemory, 'bytes')}`
      );

      // Network transfer projections
      const projectedSerialized = storagePerRecord * scale;
      console.log(
        `    Serialized size: ${this.formatSize(projectedSerialized, 'bytes')}`
      );

      // Network estimates
      const networkEstimates =
        this.calculateNetworkEstimates(projectedSerialized);
      console.log(`    Network Transfer Times:`);
      console.log(
        `      Broadband (50/10 Mbps): ${this.formatTime(networkEstimates.broadbandDownloadSec)} down, ${this.formatTime(networkEstimates.broadbandUploadSec)} up`
      );
      console.log(
        `      Fast Broadband (100/20 Mbps): ${this.formatTime(networkEstimates.fastBroadbandDownloadSec)} down, ${this.formatTime(networkEstimates.fastBroadbandUploadSec)} up`
      );
      console.log(
        `      Enterprise (1 Gbps): ${this.formatTime(networkEstimates.enterpriseTransferSec)} transfer`
      );
    });

    // VERIFICATION: Let's double-check our math with explicit examples
    console.log(`\n🔍 CALCULATION VERIFICATION:`);
    console.log(`Base measurements (1000 records):`);
    console.log(
      `  Map creation: ${result1000.mapCreationTimeMs}ms total = ${mapCreationPerRecord.toFixed(3)}ms per record`
    );
    console.log(
      `  Serialization: ${result1000.serializationTimeMs}ms total = ${serializationPerRecord.toFixed(3)}ms per record`
    );
    console.log(
      `  Storage: ${result1000.serializedSizeBytes} bytes total = ${storagePerRecord.toFixed(0)} bytes per record`
    );

    console.log(`\nProjected for 10,000 records:`);
    const check10k = {
      mapCreation: mapCreationPerRecord * 10000,
      serialization: serializationPerRecord * 10000,
      storage: storagePerRecord * 10000,
    };
    console.log(
      `  Map creation: ${check10k.mapCreation.toFixed(0)}ms = ${(check10k.mapCreation / 1000).toFixed(1)}s = ${(check10k.mapCreation / 60000).toFixed(1)}min`
    );
    console.log(
      `  Serialization: ${check10k.serialization.toFixed(1)}ms = ${(check10k.serialization / 1000).toFixed(3)}s`
    );
    console.log(`  Storage: ${this.formatSize(check10k.storage, 'bytes')}`);
  }

  /**
   * Format size with appropriate units
   */
  private formatSize(bytes: number, unit: string): string {
    if (unit !== 'bytes' && unit !== 'ms') {
      return `${bytes.toFixed(2)} ${unit}`;
    }

    if (unit === 'ms') {
      if (bytes > 60000) {
        return `${(bytes / 60000).toFixed(1)} minutes`;
      } else if (bytes > 1000) {
        return `${(bytes / 1000).toFixed(1)} seconds`;
      } else {
        return `${bytes.toFixed(0)} ms`;
      }
    }

    // Format bytes
    if (bytes > 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    } else if (bytes > 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes > 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${bytes.toFixed(0)} bytes`;
    }
  }

  /**
   * Format time with appropriate units
   */
  private formatTime(seconds: number): string {
    if (seconds > 3600) {
      return `${(seconds / 3600).toFixed(1)}h`;
    } else if (seconds > 60) {
      return `${(seconds / 60).toFixed(1)}m`;
    } else if (seconds > 1) {
      return `${seconds.toFixed(1)}s`;
    } else {
      return `${(seconds * 1000).toFixed(0)}ms`;
    }
  }

  /**
   * Print detailed benchmark results with comprehensive metrics
   */
  printResults(results: BenchmarkResult[]): void {
    console.log(`\n📈 BENCHMARK RESULTS`);
    console.log(
      `${'Records'.padEnd(10)} ${'Creation'.padEnd(12)} ${'Ser(ms)'.padEnd(10)} ${'Deser(ms)'.padEnd(12)} ${'Size'.padEnd(12)} ${'Memory'.padEnd(12)} ${'MemPerRec'.padEnd(12)}`
    );
    console.log('-'.repeat(90));

    results.forEach((result) => {
      const creationSec = (result.mapCreationTimeMs / 1000).toFixed(1);
      const sizeMB = (result.serializedSizeBytes / (1024 * 1024)).toFixed(2);
      const mapMemMB = result.mapMemoryMB.toFixed(2);
      const memPerRec = result.estimatedMemoryPerRecordBytes.toFixed(0);

      console.log(
        `${result.recordCount.toString().padEnd(10)} ` +
          `${creationSec}s`.padEnd(12) +
          ' ' +
          `${result.serializationTimeMs.toFixed(1).padEnd(10)} ` +
          `${result.deserializationTimeMs.toFixed(1).padEnd(12)} ` +
          `${sizeMB}MB`.padEnd(12) +
          ' ' +
          `${mapMemMB}MB`.padEnd(12) +
          ' ' +
          `${memPerRec}B`.padEnd(12)
      );
    });

    // Performance efficiency analysis
    console.log(`\n⚡ PERFORMANCE EFFICIENCY ANALYSIS:`);
    results.forEach((result) => {
      const efficiency = {
        creationVsSerialization:
          result.mapCreationTimeMs / result.serializationTimeMs,
        creationVsDeserialization:
          result.mapCreationTimeMs / result.deserializationTimeMs,
        serializationVsDeserialization:
          result.deserializationTimeMs / result.serializationTimeMs,
      };

      console.log(`  ${result.recordCount} records:`);
      console.log(
        `    Creation is ${efficiency.creationVsSerialization.toFixed(0)}x slower than serialization`
      );
      console.log(
        `    Creation is ${efficiency.creationVsDeserialization.toFixed(0)}x slower than deserialization`
      );
      console.log(
        `    Deserialization is ${efficiency.serializationVsDeserialization.toFixed(1)}x slower than serialization`
      );
    });
  }
}

describe('ZkUSD Checkpoint & Sync Benchmarks', () => {
  let benchmarkSuite: BenchmarkSuite;
  let results: BenchmarkResult[] = [];

  before(async () => {
    benchmarkSuite = new BenchmarkSuite();
    await benchmarkSuite.setup();
  });

  it('should benchmark 100 records', async () => {
    const result = await benchmarkSuite.runBenchmark(100);
    results.push(result);

    // Basic assertions
    assert.ok(
      result.serializationTimeMs > 0,
      'Serialization should take measurable time'
    );
    assert.ok(
      result.deserializationTimeMs > 0,
      'Deserialization should take measurable time'
    );
    assert.ok(
      result.serializedSizeBytes > 0,
      'Serialized data should have size'
    );
  });

  it('should benchmark 1,000 records', async () => {
    const result = await benchmarkSuite.runBenchmark(1000);
    results.push(result);

    // Compare with 100 records result
    const result100 = results[0];
    assert.ok(
      result.serializationTimeMs >= result100.serializationTimeMs,
      'More records should take more time to serialize'
    );
    assert.ok(
      result.serializedSizeBytes > result100.serializedSizeBytes,
      'More records should create larger files'
    );
  });

  //   it('should benchmark 5,000 records', async () => {
  //     const result = await benchmarkSuite.runBenchmark(5000);
  //     results.push(result);
  //   });

  it('should analyze linear growth and extrapolate performance', async () => {
    // Print all results
    benchmarkSuite.printResults(results);

    // Analyze linear growth using 100 and 1000 record results
    const result100 = results.find((r) => r.recordCount === 100);
    const result1000 = results.find((r) => r.recordCount === 1000);

    assert.ok(
      result100 && result1000,
      'Should have both 100 and 1000 record benchmarks'
    );

    benchmarkSuite.calculateLinearGrowth(result100!, result1000!);

    // Performance assertions (these thresholds may need tuning based on your hardware)
    console.log(`\n⚡ PERFORMANCE ASSERTIONS:`);

    // Serialization should be reasonably fast
    const serPerRecord1000 = result1000!.serializationTimeMs / 1000;
    console.log(`  Serialization: ${serPerRecord1000.toFixed(3)}ms per record`);
    assert.ok(
      serPerRecord1000 < 1,
      'Serialization should be under 1ms per record'
    );

    // File size should be reasonable
    const bytesPerRecord1000 = result1000!.serializedSizeBytes / 1000;
    console.log(`  Storage: ${bytesPerRecord1000.toFixed(0)} bytes per record`);
    assert.ok(bytesPerRecord1000 < 1000, 'Should use less than 1KB per record');

    // Deserialization should be fast
    const deserPerRecord1000 = result1000!.deserializationTimeMs / 1000;
    console.log(
      `  Deserialization: ${deserPerRecord1000.toFixed(3)}ms per record`
    );
    assert.ok(
      deserPerRecord1000 < 2,
      'Deserialization should be under 2ms per record'
    );

    console.log(`  ✅ All performance assertions passed!`);
  });

  it('should compare serialization vs deserialization performance', async () => {
    console.log(`\n⚖️  SERIALIZATION vs DESERIALIZATION COMPARISON:`);

    results.forEach((result) => {
      const ratio = result.deserializationTimeMs / result.serializationTimeMs;
      console.log(
        `  ${result.recordCount} records: Deser/Ser ratio = ${ratio.toFixed(2)}x`
      );

      if (ratio > 2) {
        console.log(
          `    ⚠️  Deserialization is significantly slower than serialization`
        );
      } else if (ratio < 0.5) {
        console.log(
          `    ℹ️  Serialization is significantly slower than deserialization`
        );
      } else {
        console.log(`    ✅ Balanced performance`);
      }
    });
  });
});
