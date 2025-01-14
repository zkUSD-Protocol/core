import {
  DynamicProof,
  Field,
  Mina,
  Provable,
  PublicKey,
  Struct,
  UInt32,
  UInt64,
  VerificationKey,
  ZkProgram,
} from 'o1js';

import {
  MinaPrice,
  MinaPriceInput,
  OraclePriceSubmissions,
  OracleWhitelist,
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
  PriceSubmission,
} from '../types.js';

/**
 * @title   Oracle Price Aggregation ZkProgram
 * @notice  This program aggregates price submissions from whitelisted oracles and produces
 *          a verified median price. It includes fallback price mechanisms and ensures
 *          all submissions are properly signed and from the current block.
 */
export const AggregateOraclePrices = ZkProgram({
  name: 'AggregateOraclePrices',
  publicInput: PriceAggregationProofPublicInput,
  publicOutput: PriceAggregationProofPublicOutput,
  methods: {
    compute: {
      privateInputs: [],
      async method(publicInput: PriceAggregationProofPublicInput) {
        const {
          oracleWhitelist,
          oraclePriceSubmissions,
          fallbackPriceSubmission,
          currentBlockHeight,
        } = publicInput;

        // Verify the fallback price submission signature
        const fallbackPrice = fallbackPriceSubmission.price;
        const fallbackBlockHeight = fallbackPriceSubmission.blockHeight;

        const validFallbackSignature = fallbackPriceSubmission.signature.verify(
          fallbackPriceSubmission.publicKey,
          [fallbackPrice.toFields()[0], fallbackBlockHeight.toFields()[0]]
        );

        validFallbackSignature.assertTrue('Invalid fallback price signature');

        // Initialize prices array with fallback price
        let prices = Array(OracleWhitelist.MAX_PARTICIPANTS).fill(
          fallbackPrice
        );

        // Ensure current block height matches fallback submission
        fallbackBlockHeight.assertEquals(currentBlockHeight);

        // Process each oracle submission
        for (let i = 0; i < oracleWhitelist.addresses.length; i++) {
          const submission = oraclePriceSubmissions.submissions[i];

          // Verify the signature of the submission
          const validSignature = submission.signature.verify(
            submission.publicKey,
            [
              submission.price.toFields()[0],
              submission.blockHeight.toFields()[0],
            ]
          );

          const isForCorrectBlock =
            submission.blockHeight.equals(currentBlockHeight);

          // Use submission price if valid and for current block, otherwise use fallback
          prices[i] = Provable.if(
            isForCorrectBlock
              .and(validSignature)
              .and(submission.price.greaterThan(UInt64.from(0))),
            submission.price,
            fallbackPrice
          );
        }

        // Sort prices using bubble sort for median calculation
        for (let i = 0; i < prices.length - 1; i++) {
          for (let j = 0; j < prices.length - i - 1; j++) {
            let shouldSwap = prices[j].greaterThan(prices[j + 1]);
            let temp = Provable.if(shouldSwap, prices[j], prices[j + 1]);
            prices[j] = Provable.if(shouldSwap, prices[j + 1], prices[j]);
            prices[j + 1] = temp;
          }
        }

        // Calculate median price from sorted array
        const middleIndex = Math.floor(prices.length / 2);
        const medianPrice = prices[middleIndex - 1]
          .add(prices[middleIndex])
          .div(UInt64.from(2));

        const protocolAdmin = fallbackPriceSubmission.publicKey;

        // Construct final price output
        const minaPrice = new MinaPrice({
          priceNanoUSD: medianPrice,
          currentBlockHeight: currentBlockHeight,
        });

        return {
          publicOutput: {
            minaPrice: minaPrice,
            incentivizedOracle: PublicKey.fromBase58(
              'B62qpnPrT5CBZ6TLHBuE9Y7EEotCic4R3z8JK3AzpCtcdhZZmmDSf3H'
            ),
            protocolAdmin: protocolAdmin,
          },
        };
      },
    },
  },
});

export const verifyMinaPriceInput = async (args: {
  input: MinaPriceInput;
  oracleWhitelistRoot: Field;
  proofVkHash: Field;
  currentBlockHeight: UInt32;
}) => {
  const { input, oracleWhitelistRoot, proofVkHash, currentBlockHeight } = args;

  input.verificationKey.hash.assertEquals(
    proofVkHash,
    'Invalid verification key hash'
  );
  input.proof.publicInput.oracleWhitelistMerkleRoot.assertEquals(
    oracleWhitelistRoot,
    'Invalid oracle whitelist root'
  );
  input.proof.publicInput.currentBlockHeight.assertEquals(
    currentBlockHeight,
    'Invalid current block height'
  );
  input.proof.verify(input.verificationKey);
};
