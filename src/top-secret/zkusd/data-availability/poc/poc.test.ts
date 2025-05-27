import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Orchestrator } from './orchestrator.js';
import { Rebuild } from './rebuild.js';
import { Field } from 'o1js';
import { MapPruner } from './map-pruner.js';

describe('ZkUsd DA Tests', () => {
  let orchestrator: Orchestrator;
  let originalRoot: string;
  let configInfo: {
    batchSize: number;
    totalOperations: number;
    expectedEpochs: number;
  };

  before(async () => {
    orchestrator = new Orchestrator();
    configInfo = orchestrator.getConfigInfo();
    console.log(
      `🔧 Test configuration: ${configInfo.totalOperations} operations, ${configInfo.batchSize} batch size, ${configInfo.expectedEpochs} expected epochs`
    );
  });

  it('should run the orchestrator (or load existing data) and have valid root', async () => {
    console.log('🚀 Starting orchestrator test...');

    // This will either run fresh or load existing data
    orchestrator.run();

    originalRoot = orchestrator.zkUsdMap.root.toString();
    console.log('📊 Final state:');
    console.log(`  - Root: ${originalRoot}`);
    console.log(`  - Length: ${orchestrator.zkUsdMap.length.toString()}`);

    // Verify we have the expected number of operations
    const expectedOperations = configInfo.totalOperations;
    const actualLength = Number(orchestrator.zkUsdMap.length.toString()) - 1; // Subtract 1 for initial (0,0) leaf

    assert.strictEqual(
      actualLength,
      expectedOperations,
      `Expected ${expectedOperations} operations, but map has ${actualLength} entries`
    );

    console.log('✅ Orchestrator test completed successfully');
  });

  it('should rebuild the tree from files and match the original root', async () => {
    console.log('🔄 Testing tree rebuild from files...');

    const rebuild = new Rebuild();
    const { finalRoot } = rebuild.rebuildFromFiles();

    console.log(`🌳 Roots comparison:`);
    console.log(`  - Original: ${originalRoot}`);
    console.log(`  - Rebuilt:  ${finalRoot}`);

    assert.strictEqual(
      finalRoot,
      originalRoot,
      'Rebuilt tree root should match the original root'
    );

    console.log('✅ Tree rebuild successful - roots match!');
  });

  it('should create pruned subset maps that maintain the same root and support inclusion proofs', async () => {
    // Get some keys that were inserted during orchestrator run
    const fullMapData = orchestrator.zkUsdMap.data.get();
    const existingKeys = fullMapData.sortedLeaves
      .filter((leaf) => leaf.key !== 0n) // Exclude the initial (0,0) leaf
      .slice(0, 3) // Take first 3 keys
      .map((leaf) => Field(leaf.key));

    // Generate some keys that definitely don't exist
    const nonExistentKeys = [
      Field(999999999n),
      Field(888888888n),
      Field(777777777n),
    ];

    console.log(
      'Testing with existing keys:',
      existingKeys.map((k) => k.toString())
    );
    console.log(
      'Testing with non-existent keys:',
      nonExistentKeys.map((k) => k.toString())
    );

    // Create pruned map
    const prunedMap = MapPruner.createPrunedMap(orchestrator.zkUsdMap, {
      keysToProveIncluded: existingKeys,
      keysToProveNotIncluded: nonExistentKeys,
    });

    // Verify same root
    assert.strictEqual(
      prunedMap.root.toString(),
      orchestrator.zkUsdMap.root.toString(),
      'Pruned map should have the same root as original'
    );

    console.log('✅ Pruned map has same root as original');

    // Test inclusion proofs
    for (const key of existingKeys) {
      try {
        prunedMap.assertIncluded(key);
        console.log(
          `✅ Successfully proved inclusion of key: ${key.toString()}`
        );
      } catch (error) {
        assert.fail(
          `Failed to prove inclusion of key ${key.toString()}: ${error}`
        );
      }
    }

    // Test non-inclusion proofs
    for (const key of nonExistentKeys) {
      try {
        prunedMap.assertNotIncluded(key);
        console.log(
          `✅ Successfully proved non-inclusion of key: ${key.toString()}`
        );
      } catch (error) {
        assert.fail(
          `Failed to prove non-inclusion of key ${key.toString()}: ${error}`
        );
      }
    }

    // Check efficiency
    const efficiency = MapPruner.estimatePruningEfficiency(
      orchestrator.zkUsdMap,
      {
        keysToProveIncluded: existingKeys,
        keysToProveNotIncluded: nonExistentKeys,
      }
    );

    console.log(
      `📊 Pruning efficiency: ${efficiency.reductionPercentage.toFixed(1)}% size reduction`
    );
    console.log(`   Original: ${efficiency.originalSize} bytes`);
    console.log(`   Pruned: ${efficiency.prunedSize} bytes`);

    console.log('✅ All pruned map tests passed!');
  });
});
