import {
  Bool,
  Field,
  Mina,
  Poseidon,
  Provable,
  PublicKey,
  UInt32,
  UInt64,
  ZkProgram,
} from 'o1js';

import {
  MinaPrice,
  MinaPriceInput,
  OraclePriceSubmissions,
  OracleWhitelist,
  PriceAggregationProofPrivateInput,
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
  PriceSubmission,
} from '../types.js';

/**
 * @title   Oracle Price Aggregation ZkProgram
 * @notice  Aggregates oracle price submissions, using a fallback price if fewer than 3 oracles are valid.
 *          If >=3 valid submissions, fallback is ignored. If fewer than 3, we pad with exactly enough fallback
 *          to get 3 total. All leftover slots are filled with a sentinel so they don't affect the median.
 */
export const AggregateOraclePrices = ZkProgram({
  name: 'AggregateOraclePrices',
  publicInput: PriceAggregationProofPublicInput,
  publicOutput: PriceAggregationProofPublicOutput,
  methods: {
    compute: {
      privateInputs: [PriceAggregationProofPrivateInput],
      async method(
        publicInput: PriceAggregationProofPublicInput,
        privateInput: PriceAggregationProofPrivateInput
      ) {
        //Helper functions

        function safeAdd(a: UInt64, b: UInt64): UInt64 {
          // If either or both are sentinel => pick the other if only one is sentinel,
          // or zero if both are sentinel.
          let aIsSentinel = a.equals(UInt64.MAXINT());
          let bIsSentinel = b.equals(UInt64.MAXINT());

          let adjustedA = Provable.if(aIsSentinel, UInt64.zero, a);
          let adjustedB = Provable.if(bIsSentinel, UInt64.zero, b);

          let adjustedAdd = adjustedA.add(adjustedB);

          return adjustedAdd;
        }

        function safeSub(a: UInt64, b: UInt64): UInt64 {
          // returns max(0, a - b) so we never underflow
          const bGreaterThanA = b.greaterThan(a);
          const adjustedB = Provable.if(bGreaterThanA, UInt64.zero, b);
          const adjustedSub = a.sub(adjustedB);
          return adjustedSub;
        }

        const {
          oracleWhitelist,
          oraclePriceSubmissions,
          fallbackPriceSubmission,
        } = privateInput;
        const { currentBlockHeight } = publicInput;

        // ─────────────────────────────────────────────────────────────────
        // 1) Validate fallback signature & block height
        // ─────────────────────────────────────────────────────────────────
        const fallbackPrice = fallbackPriceSubmission.price;
        const validFallbackSig = fallbackPriceSubmission.signature.verify(
          fallbackPriceSubmission.publicKey,
          [
            fallbackPrice.toFields()[0],
            fallbackPriceSubmission.blockHeight.toFields()[0],
          ]
        );
        validFallbackSig.assertTrue('Invalid fallback price signature');
        fallbackPriceSubmission.blockHeight.assertEquals(currentBlockHeight);

        // Compute the whitelist hash for output
        const oracleWhitelistHash = Poseidon.hash(
          OracleWhitelist.toFields(oracleWhitelist)
        );

        // ─────────────────────────────────────────────────────────────────
        // 2) Collect valid oracle submissions and count them
        // ─────────────────────────────────────────────────────────────────
        const N = OracleWhitelist.MAX_PARTICIPANTS;
        let realCount = UInt64.zero;

        // We'll store valid submissions in the front positions of this array
        let values = new Array<UInt64>(N).fill(UInt64.zero);

        // Validate each of the up to N submissions
        for (let i = 0; i < N; i++) {
          const submission = oraclePriceSubmissions.submissions[i];

          // Check signature + blockheight + positivity + not dummy
          const validSig = submission.signature.verify(submission.publicKey, [
            submission.price.toFields()[0],
            submission.blockHeight.toFields()[0],
          ]);
          const correctBlock =
            submission.blockHeight.equals(currentBlockHeight);
          const isPositive = submission.price.greaterThan(UInt64.zero);
          const isReal = submission.isDummy.not();
          const meetsAll = validSig
            .and(correctBlock)
            .and(isPositive)
            .and(isReal);

          // If meetsAll => store in values[realCount], increment realCount
          for (let j = 0; j < N; j++) {
            const jMatchesCount = UInt64.from(j).equals(realCount);
            const doStore = meetsAll.and(jMatchesCount);

            values[j] = Provable.if(doStore, submission.price, values[j]);
          }

          // Conditionally increment realCount
          realCount = Provable.if(meetsAll, realCount.add(1), realCount);
        }

        Provable.log('After collecting valid submissions', values);

        Provable.log('Real count', realCount);

        // ─────────────────────────────────────────────────────────────────
        // 3) If we have fewer than 3 oracles, add fallback until we reach 3
        //    Then fill the rest with sentinel
        // ─────────────────────────────────────────────────────────────────
        const SENTINEL = UInt64.MAXINT();

        let fallbackNeeded = safeSub(UInt64.from(3), realCount);

        // finalCount is how many items we actually use for median
        let finalCount = Provable.if(
          realCount.lessThan(UInt64.from(3)),
          UInt64.from(3),
          realCount
        );

        // Fill fallback as needed
        for (let i = 0; i < N; i++) {
          const iLit = UInt64.from(i);

          // If i >= realCount && i < realCount + fallbackNeeded => fallback
          const inFallbackSlot = iLit
            .greaterThanOrEqual(realCount)
            .and(iLit.lessThan(realCount.add(fallbackNeeded)));

          values[i] = Provable.if(inFallbackSlot, fallbackPrice, values[i]);
        }

        // Fill leftover slots with SENTINEL
        for (let i = 0; i < N; i++) {
          const iLit = UInt64.from(i);
          const isSentinelSlot = iLit.greaterThanOrEqual(
            realCount.add(fallbackNeeded)
          );
          values[i] = Provable.if(isSentinelSlot, SENTINEL, values[i]);
        }

        // ─────────────────────────────────────────────────────────────────
        // 4) Bubble sort in ascending order: no custom compare needed
        //    If an element is > next, swap them
        //    Sentinel is the largest possible, so it naturally goes to the end.
        // ─────────────────────────────────────────────────────────────────
        for (let i = 0; i < N - 1; i++) {
          for (let j = 0; j < N - i - 1; j++) {
            let shouldSwap = values[j].greaterThan(values[j + 1]);

            let temp = Provable.if(shouldSwap, values[j], values[j + 1]);
            values[j] = Provable.if(shouldSwap, values[j + 1], values[j]);
            values[j + 1] = temp;
          }
        }

        // --------------------------------------------------------------------
        // 5) Compute median among the first `finalCount` items
        // --------------------------------------------------------------------
        let conditions: Bool[] = [];
        let medianValues: UInt64[] = [];

        // Because we only have N items, we can do the standard pattern
        for (let size = 1; size <= N; size++) {
          conditions.push(finalCount.equals(UInt64.from(size)));

          if (size % 2 === 0) {
            // Even => average of mid pair
            let midIndex = size / 2;
            // Retrieve the two middle prices
            let leftVal = values[midIndex - 1];
            let rightVal = values[midIndex];

            // Safely add them, ignoring sentinel if needed
            let sumPair = safeAdd(leftVal, rightVal);
            // Then integer divide by 2
            let midpoint = sumPair.div(UInt64.from(2));
            medianValues.push(midpoint);
          } else {
            // Odd => single middle item
            let midIndex = (size - 1) / 2;
            let midVal = values[midIndex];

            // If midVal is sentinel, treat that as zero (or fallback).
            // For this snippet, we choose zero:
            let midValIsSentinel = midVal.equals(UInt64.MAXINT());
            let safeMidVal = Provable.if(midValIsSentinel, UInt64.zero, midVal);

            medianValues.push(safeMidVal);
          }
        }

        const medianPrice = Provable.switch(conditions, UInt64, medianValues);

        // --------------------------------------------------------------------
        // 6) Return results in the publicOutput
        // --------------------------------------------------------------------
        const protocolAdmin = fallbackPriceSubmission.publicKey;

        const minaPrice = new MinaPrice({
          priceNanoUSD: medianPrice,
          currentBlockHeight,
        });

        return {
          publicOutput: new PriceAggregationProofPublicOutput({
            minaPrice,
            protocolAdmin,
            oracleWhitelistHash,
          }),
        };
      },
    },
  },
});

export const verifyMinaPriceInput = async (args: {
  input: MinaPriceInput;
  oracleWhitelistHash: Field;
  proofVkHash: Field;
  currentBlockHeight: UInt32;
}) => {
  const { input, oracleWhitelistHash, proofVkHash, currentBlockHeight } = args;

  input.verificationKey.hash.assertEquals(
    proofVkHash,
    'Invalid verification key hash'
  );
  input.proof.publicInput.oracleWhitelistHash.assertEquals(
    oracleWhitelistHash,
    'Invalid oracle whitelist hash'
  );
  input.proof.publicInput.currentBlockHeight.assertEquals(
    currentBlockHeight,
    'Invalid current block height'
  );
  input.proof.verify(input.verificationKey);
};
