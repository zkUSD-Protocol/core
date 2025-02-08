import { Bool, Field, Mina, PrivateKey, Signature, UInt32, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Client } from 'mina-signer';
import {
  AggregateOraclePrices,
  PriceSubmission,
  OraclePriceSubmissions,
} from '../../../proofs/oracle-price-aggregation/prove.js';
import { TestHelper } from '../../test-helper.js';
import { OracleWhitelist } from '../../../types/oracle.js';

const client = new Client({
  network: 'testnet',
});

/**
 * Utility function to generate dynamic oracle submissions.
 * @param prices Array of prices from real oracles
 * @param th TestHelper instance for accessing oracle keys
 * @returns OraclePriceSubmissions object
 */
async function getDynamicPriceSubmissions(
  prices: (number | bigint)[],
  th: TestHelper<'local'>
): Promise<OraclePriceSubmissions> {
  const oracleCount = th.whitelist.addresses.length;
  const blockHeight = Mina.getNetworkState().blockchainLength;
  const submissions: PriceSubmission[] = [];

  for (let i = 0; i < oracleCount; i++) {
    const oracleName = 'oracle' + (i + 1);
    const oraclePrivateKey = th.oracles[oracleName].privateKey;
    const oraclePublicKey = th.oracles[oracleName].publicKey;

    const isReal = i < prices.length;
    const priceValue = isReal ? UInt64.from(prices[i]) : UInt64.zero;

    if (isReal) {
      const signature = client.signFields(
        [priceValue.toBigInt(), blockHeight.toBigint()],
        oraclePrivateKey.toBase58()
      );

      submissions.push(
        new PriceSubmission({
          publicKey: oraclePublicKey,
          price: priceValue,
          blockHeight: blockHeight,
          signature: Signature.fromBase58(signature.signature),
          isDummy: Bool(false),
        })
      );
    } else {
      submissions.push(
        new PriceSubmission({
          publicKey: oraclePublicKey,
          price: UInt64.zero,
          blockHeight: blockHeight,
          signature: Signature.empty(),
          isDummy: Bool(true),
        })
      );
    }
  }

  return new OraclePriceSubmissions({ submissions });
}

describe('Oracle Price Aggregation Test Suite', () => {
  let th: TestHelper<'local'>;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
  });

  it('should compute median with 3 valid prices', async () => {
    const prices = [100n, 120n, 110n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '110'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '3'
    );
  });

  it('should handle even number of valid prices', async () => {
    const prices = [100n, 120n, 110n, 130n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // Median should be (110 + 120) / 2 = 115
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '115'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '4'
    );
  });

  it('should reject submissions with invalid block height', async () => {
    const prices = [100n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    // Modify block height to be invalid
    oraclePriceSubmissions.submissions[0].blockHeight = UInt32.from(999999);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    // try {
    await assert.rejects(async () => {
      await AggregateOraclePrices.compute(
        {
          currentBlockHeight: blockHeight,
          oracleWhitelistHash,
        },
        {
          oracleWhitelist: th.whitelist,
          oraclePriceSubmissions,
        }
      );
    }, new RegExp('Constraint unsatisfied'));
  });

  it('should reject submissions that would cause overflow in median calculation', async () => {
    const BIG = (1n << 64n) - 1n; // Max UInt64 value
    const prices = [1n, BIG, 50n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    await assert.rejects(async () => {
      await AggregateOraclePrices.compute(
        {
          currentBlockHeight: blockHeight,
          oracleWhitelistHash,
        },
        {
          oracleWhitelist: th.whitelist,
          oraclePriceSubmissions,
        }
      );
    }, /Constraint unsatisfied/);
  });

  it('should handle submissions with large but safe price values', async () => {
    // Using large but safe numbers that won't overflow when added/divided
    const LARGE = 1000000000000n; // 1 trillion
    const prices = [LARGE - 10n, LARGE, LARGE + 10n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // Median should be LARGE (the middle value)
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      LARGE.toString()
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '3'
    );
  });

  it('should track valid submissions correctly', async () => {
    const prices = [100n, 120n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // Check first two submissions are valid
    assert(
      result.proof.publicOutput.validSubmissions.valid[0].submissionValid.toBoolean()
    );
    assert(
      result.proof.publicOutput.validSubmissions.valid[1].submissionValid.toBoolean()
    );

    // Check remaining submissions are invalid
    for (let i = 2; i < th.whitelist.addresses.length; i++) {
      assert(
        !result.proof.publicOutput.validSubmissions.valid[
          i
        ].submissionValid.toBoolean()
      );
    }
  });

  it('should compute correct median with all oracles submitting same price', async () => {
    const prices = Array(8).fill(100n); // All 8 oracles submit 100
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '100'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '8'
    );
  });

  it('should compute correct median with all oracles submitting ascending prices', async () => {
    const prices = [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // Median with 8 values should be average of 4th and 5th values: (40 + 50) / 2 = 45
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '45'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '8'
    );
  });

  it('should compute correct median with all oracles submitting descending prices', async () => {
    const prices = [80n, 70n, 60n, 50n, 40n, 30n, 20n, 10n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // Median with 8 values should be average of 4th and 5th values: (50 + 40) / 2 = 45
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '45'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '8'
    );
  });

  it('should compute correct median with all oracles submitting unordered prices', async () => {
    const prices = [30n, 10n, 70n, 50n, 20n, 60n, 40n, 80n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // After sorting: [10, 20, 30, 40, 50, 60, 70, 80]
    // Median should be (40 + 50) / 2 = 45
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '45'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '8'
    );
  });

  it('should compute correct median with all oracles submitting with duplicates', async () => {
    const prices = [40n, 40n, 40n, 40n, 50n, 50n, 50n, 50n];
    const oraclePriceSubmissions = await getDynamicPriceSubmissions(prices, th);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const oracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const result = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: th.whitelist,
        oraclePriceSubmissions,
      }
    );

    // After sorting: [40, 40, 40, 40, 50, 50, 50, 50]
    // Median should be (40 + 50) / 2 = 45
    assert.strictEqual(
      result.proof.publicOutput.minaPrice.priceNanoUSD.toString(),
      '45'
    );
    assert.strictEqual(
      result.proof.publicOutput.validSubmissions.count.toString(),
      '8'
    );
  });
});
