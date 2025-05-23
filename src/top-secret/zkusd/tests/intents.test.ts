import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Keys } from '../types/keys.js';
import { PrivateKey, UInt8, initializeBindings } from 'o1js';
import { VaultMap } from '../data/vault-map.js';
import {
  CreateVaultIntent,
  generateCreateVaultIntentInputs,
} from '../programs/intents/create-vault.js';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import fs from 'fs/promises';
import { bcs } from '@mysten/sui/bcs';

describe('ZkUsd Payment Address Test Suite', () => {
  let vaultMap: VaultMap;
  let alice: Keys;

  // Sui client
  let client: SuiClient;

  // Sui keys
  let adminSuiKey: Ed25519Keypair = Ed25519Keypair.generate();
  let aliceSuiKey: Ed25519Keypair = Ed25519Keypair.generate();

  // Sui contract addresses
  let packageId: string;
  let intentQueueSystemId: string;
  let validatorRegistryId: string;

  async function fundAddress(address: string) {
    try {
      // For local network
      await requestSuiFromFaucetV2({
        host: getFaucetHost('localnet'),
        recipient: address,
      });

      // Verify the balance
      const balance = await client.getBalance({
        owner: address,
      });

      console.log(`Funded address ${address} with balance:`, balance);
    } catch (e) {
      console.error('Failed to fund address:', e);
      throw e;
    }
  }

  async function publishIntentModule() {
    const tx = new Transaction();

    const dependencies = [
      '0x1', // Move Standard Library
      '0x2', // Sui Framework
      '0x3', // Sui System
      '0xb', // Sui Bridge
    ];

    // Publish the package
    const [upgradeCap] = tx.publish({
      modules: [
        // You'll need to read your compiled Move module
        await fs.readFile(
          '/Users/mack/Projects/Blockchain/mina/zkusd-protocol/core/src/top-secret/zkusd/sequencer/build/zkusd/bytecode_modules/intents.mv',
          'base64'
        ),
      ],
      dependencies,
    });

    tx.transferObjects(
      [upgradeCap],
      tx.pure(adminSuiKey.getPublicKey().toRawBytes())
    );

    // Execute the publish transaction
    const publishResult = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: adminSuiKey,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    for (const obj of publishResult.objectChanges || []) {
      if (obj.type === 'published') {
        packageId = obj.packageId;
      }

      if (
        obj.type === 'created' &&
        obj.objectType.includes('::intents::IntentQueueSystem')
      ) {
        intentQueueSystemId = obj.objectId;
      }
      if (
        obj.type === 'created' &&
        obj.objectType.includes('::intents::ValidatorRegistry')
      ) {
        validatorRegistryId = obj.objectId;
      }
    }
  }

  before(async () => {
    await initializeBindings();
    alice = Keys.fromPrivateKey(PrivateKey.random());
    vaultMap = new VaultMap();

    client = new SuiClient({
      url: 'http://localhost:9000',
    });

    //Fund admin and alice
    await fundAddress(adminSuiKey.getPublicKey().toSuiAddress());
    await fundAddress(aliceSuiKey.getPublicKey().toSuiAddress());

    //Publish the intent module
    await publishIntentModule();
  });

  it('should create an intent and send it to the intent queue', async () => {
    const { publicInput, privateInput } = await generateCreateVaultIntentInputs(
      {
        vaultMap,
        type: UInt8.zero,
        privateKey: alice.spendingKey,
      }
    );

    const {
      publicOutput: { vaultKey, vaultType },
    } = await CreateVaultIntent.rawMethods.createVault(
      publicInput,
      privateInput
    );

    console.log('vaultKey', vaultKey);
    console.log('vaultType', vaultType);
    const vaultMapRoot = publicInput.vaultMapRoot.toString();

    const tx = new Transaction();

    tx.moveCall({
      target: `${packageId}::intents::IntentQueueSystem::send_intent`,
      arguments: [
        tx.object(intentQueueSystemId),
        tx.pure(bcs.U8.serialize(0)), //create vault type
        tx.pure(bcs.String.serialize('test_da_hash')), // da_hash
        tx.pure(bcs.String.serialize(vaultMapRoot)), //vault_root
      ],
    });
  });
});
