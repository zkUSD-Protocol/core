import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { VaultMap, PrunedVaultMap } from './vault-map.js';
import { ZkUsdMap, PrunedZkUsdMap } from './zkusd-map.js';
import { Field } from 'o1js';

// Utility function to calculate JSON size
function getJsonSize(obj: any): number {
  return JSON.stringify(obj).length;
}

// Utility function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

describe('ZkUsd Map Serialization Tests', () => {
  // Create and populate maps
  const vaultMap = new VaultMap();
  const zkUsdMap = new ZkUsdMap();

  before(async () => {
    vaultMap.insert(Field(1), Field(100));
    vaultMap.insert(Field(2), Field(200));

    // Let's make the zkusd map a bit bigger
    for (let i = 1; i < 100; i++) {
      zkUsdMap.insert(Field(i), Field(i * 100));
    }
  });

  it('should serialize the maps', async () => {
    console.log('🚀 Starting map serialization test...');

    const serializedVaultMap = vaultMap.serialize();
    const serializedZkUsdMap = zkUsdMap.serialize();

    // Size of the serialized maps
    const vaultMapSize = getJsonSize(serializedVaultMap);
    const zkUsdMapSize = getJsonSize(serializedZkUsdMap);

    console.log('Serialized vault map size:', formatBytes(vaultMapSize));
    console.log('Serialized zkusd map size:', formatBytes(zkUsdMapSize));

    // Test that they can be deserialized
    const restoredVaultMap = VaultMap.fromSerialized(serializedVaultMap);
    const restoredZkUsdMap = ZkUsdMap.fromSerialized(serializedZkUsdMap);

    // Verify integrity
    assert.strictEqual(
      vaultMap.root.toString(),
      restoredVaultMap.root.toString(),
      'Vault map roots should match'
    );

    assert.strictEqual(
      zkUsdMap.root.toString(),
      restoredZkUsdMap.root.toString(),
      'ZkUsd map roots should match'
    );

    console.log('✅ Maps serialized and deserialized successfully');
  });

  it('should create and serialize pruned maps', async () => {
    console.log('🔍 Testing pruned map serialization...');

    // Create pruned maps
    const prunedVaultMap = vaultMap.createPruned({
      keysToProveIncluded: [Field(1), Field(2)],
      keysToProveNotIncluded: [],
    });

    const prunedZkUsdMap = zkUsdMap.createPruned({
      keysToProveIncluded: [Field(1), Field(50), Field(99)],
      keysToProveNotIncluded: [Field(101)],
    });

    // Serialize pruned maps
    const serializedPrunedVaultMap = prunedVaultMap.serialize();
    const serializedPrunedZkUsdMap = prunedZkUsdMap.serialize();

    // Calculate sizes
    const fullVaultMapSize = getJsonSize(vaultMap.serialize());
    const prunedVaultMapSize = getJsonSize(serializedPrunedVaultMap);
    const fullZkUsdMapSize = getJsonSize(zkUsdMap.serialize());
    const prunedZkUsdMapSize = getJsonSize(serializedPrunedZkUsdMap);

    console.log('Full vault map size:', formatBytes(fullVaultMapSize));
    console.log('Pruned vault map size:', formatBytes(prunedVaultMapSize));
    console.log(
      'Vault map reduction:',
      (
        ((fullVaultMapSize - prunedVaultMapSize) / fullVaultMapSize) *
        100
      ).toFixed(2) + '%'
    );

    console.log('Full zkUsd map size:', formatBytes(fullZkUsdMapSize));
    console.log('Pruned zkUsd map size:', formatBytes(prunedZkUsdMapSize));
    console.log(
      'ZkUsd map reduction:',
      (
        ((fullZkUsdMapSize - prunedZkUsdMapSize) / fullZkUsdMapSize) *
        100
      ).toFixed(2) + '%'
    );

    // Test that pruned maps can be deserialized
    const restoredPrunedVaultMap = PrunedVaultMap.fromSerialized(
      serializedPrunedVaultMap
    );
    const restoredPrunedZkUsdMap = PrunedZkUsdMap.fromSerialized(
      serializedPrunedZkUsdMap
    );

    // Verify they can still prove the required keys
    assert.strictEqual(
      prunedVaultMap.get(Field(1)).toString(),
      restoredPrunedVaultMap.get(Field(1)).toString(),
      'Pruned vault map should preserve values'
    );

    assert.strictEqual(
      prunedZkUsdMap.get(Field(50)).toString(),
      restoredPrunedZkUsdMap.get(Field(50)).toString(),
      'Pruned zkUsd map should preserve values'
    );

    console.log('✅ Pruned maps serialized and deserialized successfully');
  });
});
