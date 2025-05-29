import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { VaultMap, PrunedVaultMap } from './vault-map.js';
import { ZkUsdMap, PrunedZkUsdMap } from './zkusd-map.js';
import { Field } from 'o1js';

describe('ZkUsd DA Tests', () => {
  // Create and populate maps
  const vaultMap = new VaultMap();
  const zkUsdMap = new ZkUsdMap();

  before(async () => {
    vaultMap.insert(Field(1), Field(100));
    vaultMap.insert(Field(2), Field(200));

    zkUsdMap.insert(Field(1), Field(1000));
    zkUsdMap.insert(Field(2), Field(2000));
  });

  it('should serialize the maps', async () => {
    console.log('🚀 Starting orchestrator test...');

    const serializedVaultMap = vaultMap.serialize();
    const serializedZkUsdMap = zkUsdMap.serialize();

    console.log(serializedVaultMap);
  });
});
