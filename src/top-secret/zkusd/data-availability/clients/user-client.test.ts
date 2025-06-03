import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Keys } from '../../types/keys.js';
import { PrivateKey, UInt8, initializeBindings } from 'o1js';
import { VaultMap } from '../../data/maps/vault-map.js';
import {
  CreateVaultIntent,
  generateCreateVaultIntentInputs,
} from '../../programs/intents/create-vault.js';
import { UserDAClient } from './user-client.js';
import { IntentProof, IntentProofHelper } from '../../types/intent-proof.js';

describe('UserDAClient Test Suite', () => {
  let userDAClient: UserDAClient;
  let vaultMap: VaultMap;
  let alice: Keys;
  let blobId: string;

  before(async () => {
    await initializeBindings();
    alice = Keys.fromPrivateKey(PrivateKey.random());
    vaultMap = new VaultMap();
    userDAClient = UserDAClient.forLocal();

    // Compile the zk programs
    console.log('Compiling zkprogram');
    console.time('CreateVaultIntent');
    await CreateVaultIntent.compile();
    console.timeEnd('CreateVaultIntent');
  });

  it('should publish intent proof to Walrus and return blob ID', async () => {
    // Generate a real intent proof
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

    const intentProof: IntentProof = {
      kind: 'create-vault',
      proof: proof,
    };

    // Publish to Walrus
    blobId = await userDAClient.publishIntentProof(intentProof);

    console.log('blobId', blobId);
    console.log('blobId length', blobId.length);

    // Verify blob ID is returned
    assert(typeof blobId === 'string');
    assert(blobId.length > 0);
    console.log('Published intent proof with blob ID:', blobId);
  });

  it('it should deserialize intent proof', async () => {
    const data = await userDAClient.readFromWalrus(blobId);
    const parsedData = JSON.parse(data);
    const intentProof: IntentProof =
      await IntentProofHelper.fromJSON(parsedData);
    assert.strictEqual(intentProof.kind, 'create-vault');
    assert(intentProof.proof);

    intentProof.proof.verify();

    console.log('Successfully verified intent proof round-trip');
  });
});
