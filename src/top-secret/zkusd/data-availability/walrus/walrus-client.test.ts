import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { WalrusClient } from '@mysten/walrus';
import { createWalrusClient } from './walrus-client.js';
import { suiSigner } from '../../config/keys.js';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { randomBytes } from 'node:crypto';

//Write a test to simulate two files being stored in walrus such as our metadata and block file
//See how many SUI transactions were made
//See what the gas costs are and WAL
//Then optimise the costs by combining

const WALRUS_TOKEN_PRICE = 0.55;
const SUI_TOKEN_PRICE = 3.24;

function toUSD(amount: number, token: 'WAL' | 'SUI') {
  let usdCost;
  if (token === 'WAL') {
    usdCost = amount * WALRUS_TOKEN_PRICE;
  } else if (token === 'SUI') {
    usdCost = amount * SUI_TOKEN_PRICE;
  } else {
    throw new Error('Invalid token');
  }

  return usdCost.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  });
}

describe('ZkUsd DA Tests', () => {
  // Create and populate maps

  let client: WalrusClient;
  let suiClient: SuiClient;

  before(async () => {
    client = await createWalrusClient({
      network: 'testnet',
    });

    suiClient = new SuiClient({
      url: getFullnodeUrl('testnet'),
    });
  });

  it('should analyse the cost of storing a blob', async () => {
    const blobId = 'xG8A-CknWuWjMZWTJUXnDghbCS6YQNDaGB7mvxGrzG0';
    const epochs = 3;

    //Generate a blob of a 100kb
    // const blobBuffer = randomBytes(100 * 1024);
    //Lets do a 10mb blob
    const blobBuffer = randomBytes(100 * 1024);
    const blob = new Uint8Array(blobBuffer);
    const blob2 = new Uint8Array(blobBuffer);

    const beforeSuiBalance = await suiClient.getBalance({
      owner: suiSigner.getPublicKey().toSuiAddress(),
      coinType: '0x2::sui::SUI',
    });

    const beforeWalrusBalance = await suiClient.getBalance({
      owner: suiSigner.getPublicKey().toSuiAddress(),
      coinType:
        '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL',
    });

    console.log('Sui balance before storing: ', beforeSuiBalance.totalBalance);
    console.log(
      'Walrus balance before storing: ',
      beforeWalrusBalance.totalBalance
    );

    const cost = await client.storageCost(blob.length, epochs);

    const ExpectedCosts = {
      storageCost: Number(cost.storageCost) / 1e9,
      writeCost: Number(cost.writeCost) / 1e9,
      totalCost: Number(cost.totalCost) / 1e9,
    };

    console.log('Storing a blob of size: ', blob.length, 'bytes');

    const writeBlobResult = await client.writeBlob({
      blob,
      deletable: true,
      epochs,
      signer: suiSigner,
    });

    const writeBlobResult2 = await client.writeBlob({
      blob: blob2,
      deletable: true,
      epochs,
      signer: suiSigner,
    });

    console.log(writeBlobResult);

    console.log(
      'Total Size of storage: ',
      Number(writeBlobResult.blobObject.storage.storage_size) / 1024 / 1024,
      'MB'
    );

    const afterSuiBalance = await suiClient.getBalance({
      owner: suiSigner.getPublicKey().toSuiAddress(),
      coinType: '0x2::sui::SUI',
    });

    const afterWalrusBalance = await suiClient.getBalance({
      owner: suiSigner.getPublicKey().toSuiAddress(),
      coinType:
        '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL',
    });

    const actualWalrusCost =
      Number(beforeWalrusBalance.totalBalance) -
      Number(afterWalrusBalance.totalBalance);

    const actualSuiCost =
      Number(beforeSuiBalance.totalBalance) -
      Number(afterSuiBalance.totalBalance);

    console.log(
      'Expected Write Cost of storing the blob: ',
      ExpectedCosts.writeCost
    );
    console.log(
      'Expected Storage Cost of storing the blob: ',
      ExpectedCosts.storageCost
    );
    console.log(
      'Expected Total Cost of storing the blob: ',
      ExpectedCosts.totalCost
    );

    console.log(
      'What we spent on WAL: This should equal the total cost ',
      actualWalrusCost / 1e9,
      'WAL'
    );
    console.log(
      'What we spent on SUI: This is the gas we spent',
      actualSuiCost / 1e9,
      'SUI'
    );

    console.log(`We spent ${toUSD(actualWalrusCost / 1e9, 'WAL')} USD on WAL`);
    console.log(`We spent ${toUSD(actualSuiCost / 1e9, 'SUI')} USD on SUI`);
  });
});
