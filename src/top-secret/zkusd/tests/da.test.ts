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
} from '../data-availability/walrus.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import fs from 'fs/promises';
import { bcs } from '@mysten/sui/bcs';
import { AggregateOraclePrices } from '../../../proofs/oracle-price-aggregation/prove.js';
import { BurnIntent } from '../programs/intents/burn.js';
import { LiquidateIntent } from '../programs/intents/liquidate.js';
import { MintIntent } from '../programs/intents/mint.js';
import { RedeemIntent } from '../programs/intents/redeem.js';
import { TransferIntent } from '../programs/intents/transfer.js';
import { ZkUsdRollup } from '../programs/rollup.js';
import { DepositIntent } from '../programs/intents/deposit.js';

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
