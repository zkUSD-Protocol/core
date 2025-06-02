import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Keys } from '../types/keys.js';
import { PrivateKey, UInt8, initializeBindings } from 'o1js';
import { VaultMap } from '../data/maps/vault-map.js';
import {
  CreateVaultIntent,
  generateCreateVaultIntentInputs,
} from '../programs/intents/create-vault.js';
import { SuiClient } from '@mysten/sui/client';
import {
  getWalrusUrl,
  readFromWalrus,
  saveToWalrus,
} from '../data-availability/utils/walrus.js';

describe('ZkUsd Walrus Test Suite', () => {
  let vaultMap: VaultMap;
  let alice: Keys;

  before(async () => {
    await initializeBindings();
    alice = Keys.fromPrivateKey(PrivateKey.random());
    vaultMap = new VaultMap();

    //compile the zk programs
    console.log('compiling zkprogram');
    console.time('CreateVaultIntent');
    await CreateVaultIntent.compile();
    console.timeEnd('CreateVaultIntent');
    console.timeEnd('compiled zkprograms');
  });

  it('should generate and store the proof', async () => {
    const { publicInput, privateInput } = await generateCreateVaultIntentInputs(
      {
        vaultMap,
        type: UInt8.zero,
        privateKey: alice.spendingKey,
      }
    );

    const { proof } = await CreateVaultIntent.createVault(
      publicInput,
      privateInput
    );

    const jsonProof = JSON.stringify(proof.toJSON());

    //size in bytes of the proof
    const sizeInBytes = jsonProof.length;
    console.log('sizeInBytes', sizeInBytes);

    const vaultMapRoot = publicInput.vaultMapRoot.toString();

    const blobId = await saveToWalrus({ data: jsonProof });

    console.log('blobId', blobId);
  });
});
