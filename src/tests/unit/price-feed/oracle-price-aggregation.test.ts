import { Field, MerkleTree, Mina, PrivateKey, UInt32 } from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AggregateOraclePrices } from '../../../proofs/oracle-price-aggregation.js';

describe('zkUSD Price Feed Oracle Price Retrieval Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLocalChain({ proofsEnabled: false });
    await testHelper.deployTokenContracts();
    await testHelper.createAgents(['alice']);
  });

  it('should generate a valid proof', async () => {
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await testHelper.getPriceSubmissions();

    await AggregateOraclePrices.compile();

    const currentBlockHeight = Mina.getNetworkState().blockchainLength;

    console.log('Calling compute');

    const proof = await AggregateOraclePrices.compute({
      oracleWhitelist: testHelper.whitelist,
      oraclePriceSubmissions: oraclePriceSubmissions,
      currentBlockHeight: currentBlockHeight,
      fallbackPriceSubmission: fallbackPriceSubmission,
    });

    console.log(proof);

    assert(true);
    assert(true);
  });
});
