import { Bool, Field, Mina, PrivateKey, Signature, UInt32, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AggregateOraclePrices } from '../../../proofs/oracle-price-aggregation.js';
import { TestHelper } from '../../test-helper.js';
import { OraclePriceSubmissions, PriceSubmission } from '../../../types.js';
import { Client } from 'mina-signer';

const client = new Client({
  network: 'testnet',
});

/**
 * Utility function to generate dynamic oracle submissions.
 * - prices: An array of numbers (or bigint) representing the real oracle-submitted prices.
 * - fallback: The fallback price (number or bigint).
 * - testHelper: so we can sign and produce valid signatures from the oracles.
 *
 * This returns an object:
 * {
 *   oraclePriceSubmissions: OraclePriceSubmissions,
 *   fallbackPriceSubmission: PriceSubmission
 * }
 */
async function getDynamicPriceSubmissions(
  prices: (number | bigint)[],
  fallback: number | bigint,
  testHelper: TestHelper
) {
  // We'll re-use testHelper's oracles from the local whitelist.
  // Suppose we only use as many oracles as we have real prices in the array.
  // The rest we mark as dummy = true.

  // Ensure that we at least fill out as many oracles as the contract expects.
  const oracleCount = testHelper.whitelist.addresses.length;

  const blockHeight = Mina.getNetworkState().blockchainLength;

  // Build OraclePriceSubmissions
  const submissions: PriceSubmission[] = [];

  for (let i = 0; i < oracleCount; i++) {
    const oracleName = 'oracle' + (i + 1);
    const oraclePrivateKey = testHelper.oracles[oracleName].privateKey;
    const oraclePublicKey = testHelper.oracles[oracleName].publicKey;

    // If i < prices.length, we treat this as a real oracle submission
    // Otherwise, mark as dummy submission with zero price
    const isReal = i < prices.length;
    const priceValue = isReal ? UInt64.from(prices[i]) : UInt64.zero;
    const signatureFields = [
      priceValue.toFields()[0],
      blockHeight.toFields()[0],
    ];
    const signatureBase58 = client.signFields(
      signatureFields.map((f) => f.toBigInt()),
      oraclePrivateKey.toBase58()
    );

    submissions.push(
      new PriceSubmission({
        publicKey: oraclePublicKey,
        price: priceValue,
        blockHeight: blockHeight,
        signature: Signature.fromBase58(signatureBase58.signature),
        isDummy: isReal ? Bool(false) : Bool(true),
      })
    );
  }

  // Build fallbackPriceSubmission
  const fallbackPrice = UInt64.from(fallback);
  const fallbackSigFields = [
    fallbackPrice.toFields()[0],
    blockHeight.toFields()[0],
  ];
  const fallbackSigBase58 = client.signFields(
    fallbackSigFields.map((f) => f.toBigInt()),
    testHelper.networkKeys.protocolAdmin.privateKey.toBase58()
  );

  const fallbackPriceSubmission = new PriceSubmission({
    publicKey: testHelper.networkKeys.protocolAdmin.publicKey,
    price: fallbackPrice,
    blockHeight: blockHeight,
    signature: Signature.fromBase58(fallbackSigBase58.signature),
    isDummy: Bool(false),
  });

  return {
    oraclePriceSubmissions: { submissions },
    fallbackPriceSubmission,
  };
}

describe('zkUSD Price Feed Oracle Price Retrieval Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    // Initialize a local chain with your contracts deployed and some oracles set up
    await testHelper.initLocalChain({ proofsEnabled: false });
    await testHelper.deployTokenContracts();
    // This ensures we have at least "oracle1", "oracle2", ..., "oracle8" addresses in the whitelist
    // since we fill out testHelper.whitelist in deployTokenContracts (for local networks).
    await testHelper.createAgents(['alice']);
  });

  it('should handle 0 valid oracles => fallback used thrice => median = fallback', async () => {
    // Pass empty array for real oracles => all oracles are dummy
    // fallback = 99
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([], 99, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );

    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '99');
  });

  it('should handle 1 real oracle (50) & fallback is the same => median=50', async () => {
    // 1 real oracle=50, fallback=50 => final 3= [50, 50, 50], median=50
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([50], 50, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '50');
  });

  it('should handle 2 real oracles (same=100) + fallback smaller=50 => median=100', async () => {
    // Real oracles= [100, 100], fallback= 50
    // => array = [100, 100, 50], sorted => [50,100,100], median=100
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([100, 100], 50, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '100');
  });

  it('should handle 2 real oracles + fallback is UInt64.MAXINT => fallback sorted at end => median is the second oracle', async () => {
    // Suppose your range is 64 bits => Max: 18446744073709551615n
    const MAXINT = (1n << 64n) - 1n;
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([20, 30], MAXINT, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    // After sorting => [20,30,MAXINT], median=30
    assert.strictEqual(median.toString(), '30');
  });

  it('should handle 3 oracles ignoring fallback => all same => median = that same price', async () => {
    // Real oracles= [100,100,100], fallback= 2
    // => ignoring fallback => median=100
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([100, 100, 100], 2, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '100');
  });

  it('should handle 5 valid oracles => fallback is ignored => check duplicates + distinct', async () => {
    // Real oracles= [5, 1, 1, 9, 2], fallback= 999
    // Sorted => [1,1,2,5,9], median= 2 (the 3rd item)
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([5, 1, 1, 9, 2], 999, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '2');
  });

  it('should handle extremely large and small oracles => fallback in middle => correct median', async () => {
    // Real oracles= [1, 18446744073709551615n], fallback= 50
    // => final list= [1, 18446744073709551615n, 50]
    // => sorted= [1, 50, 18446744073709551615n], median=50
    const BIG = (1n << 64n) - 1n; // 18446744073709551615n
    const { oraclePriceSubmissions, fallbackPriceSubmission } =
      await getDynamicPriceSubmissions([1, BIG], 50n, testHelper);

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '50');
  });

  it('should handle an invalid oracle submission => effectively 0 real => fallback thrice', async () => {
    // We'll do one real submission with an incorrect blockHeight so it's invalid
    // So effectively we have 0 real oracles => median should be fallback=333
    // We'll duplicate the getDynamicPriceSubmissions logic but sabotage blockHeight
    const badOracleSubmission = new PriceSubmission({
      publicKey: testHelper.oracles.oracle1.publicKey,
      price: UInt64.from(99),
      blockHeight: UInt32.from(9999999), // incorrect
      signature: Signature.create(
        PrivateKey.fromBase58(testHelper.oracles.oracle1.privateKey.toBase58()),
        [Field(99), Field(9999999)]
      ),
      isDummy: Bool(false),
    });

    // Meanwhile fallback=333 => valid
    const { fallbackPriceSubmission } = await getDynamicPriceSubmissions(
      [],
      333,
      testHelper
    );

    // Make a manual oraclePriceSubmissions
    const oraclePriceSubmissions = { submissions: [] as PriceSubmission[] };
    // Fill up to match the whitelist length
    for (let i = 0; i < testHelper.whitelist.addresses.length; i++) {
      // The first one is our invalid submission, the rest are dummy
      const sub =
        i === 0
          ? badOracleSubmission
          : new PriceSubmission({
              publicKey: testHelper.oracles['oracle' + (i + 1)].publicKey,
              price: UInt64.zero,
              blockHeight: Mina.getNetworkState().blockchainLength,
              signature: Signature.create(
                PrivateKey.fromBase58(
                  testHelper.oracles['oracle' + (i + 1)].privateKey.toBase58()
                ),
                [
                  Field(0),
                  Mina.getNetworkState().blockchainLength.toFields()[0],
                ]
              ),
              isDummy: Bool(true),
            });
      oraclePriceSubmissions.submissions.push(sub);
    }

    const blockHeight = Mina.getNetworkState().blockchainLength;
    const proof = await AggregateOraclePrices.compute(
      { currentBlockHeight: blockHeight },
      {
        oracleWhitelist: testHelper.whitelist,
        oraclePriceSubmissions,
        fallbackPriceSubmission,
      }
    );

    // We expect 0 valid => fallback thrice => median=333
    const median = proof.proof.publicOutput.minaPrice.priceNanoUSD;
    assert.strictEqual(median.toString(), '333');
  });

  // Feel free to add more variations as you see fit, e.g. duplicates, partial matches,
  // 4 oracles ignoring fallback, etc.
});
