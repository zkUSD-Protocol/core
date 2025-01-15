import {
  Bool,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  Struct,
  UInt32,
  UInt64,
  ZkProgram,
} from 'o1js';

import {
  MinaPrice,
  OracleWhitelist,
} from '../../types.js';
import { PriceAggregationProofPublicInput, PriceAggregationProofPublicOutput } from './common.js';

/**
 * @notice Represents a single price submission from an oracle
 */
class PriceSubmission extends Struct({
  publicKey: PublicKey,
  signature: Signature,
  price: UInt64,
  blockHeight: UInt32,
  isDummy: Bool,
}) {}

/**
 * @notice Collection of oracle price submissions
 */
class OraclePriceSubmissions extends Struct({
  submissions: Provable.Array(PriceSubmission, OracleWhitelist.MAX_PARTICIPANTS)
}) {}

/**
 * @notice Input data structure for price aggregation proof
 *         The price submissions must match the oracle whitelist order.
 */
class PriceAggregationProofPrivateInput extends Struct({
  oracleWhitelist: OracleWhitelist,
  oraclePriceSubmissions: OraclePriceSubmissions,
}) {}


/**
 * @title   Oracle Price Aggregation ZkProgram
 * @notice  Aggregates oracle price submissions. It will verify each submission
 *          and compute a median value out of the valid submissions.
 *          If there's no valid submission it will throw.
 */
const AggregateOraclePrices = ZkProgram({
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
        let masterOracleUsed = Bool(false);
        let usedOraclesCount = UInt32.zero;
        let usedOraclesHash = Field.from(0);
        let minaPrice = new MinaPrice({ currentBlockHeight: publicInput.currentBlockHeight, priceNanoUSD: UInt64.zero });

        const N = OracleWhitelist.MAX_PARTICIPANTS;

        // We'll store valid submissions in the front positions of this array
        let values = new Array<UInt64>(N).fill(UInt64.zero);

        // Validate each of the up to N submissions
        let ix = UInt32.zero;
        for (let i = 0; i < N; i++) {
          const submission = privateInput.oraclePriceSubmissions.submissions[i];

          // Check signature + blockheight + positivity + not dummy
          const validSig = submission.signature.verify(submission.publicKey, [
            submission.price.toFields()[0],
            submission.blockHeight.toFields()[0],
          ]);
          const isWhitelisted = privateInput.oracleWhitelist.addresses[i].equals(submission.publicKey);
          const correctBlock =
            submission.blockHeight.equals(publicInput.currentBlockHeight);
          const isPositive = submission.price.greaterThan(UInt64.zero);
          const isReal = submission.isDummy.not();
          const validSubmission = validSig
            .and(isWhitelisted)
            .and(correctBlock)
            .and(isPositive)
            .and(isReal);

          // if valid then add to values, count and hash
          values[i] = Provable.if(validSubmission, submission.price, UInt64.zero);
          usedOraclesCount = Provable.if(validSubmission, usedOraclesCount.add(1), usedOraclesCount);
          const pkh = Poseidon.hash(submission.publicKey.toFields());
          usedOraclesHash = Provable.if(
            validSubmission,
            Provable.if(
              usedOraclesCount.equals(UInt32.zero),
              pkh,
              Poseidon.hash([usedOraclesHash, pkh])),
            usedOraclesHash);

          masterOracleUsed = Provable.if(
            // if at the master oracle index
            ix.equals(privateInput.oracleWhitelist.masterOracleIndex)
              // and the submission is valid
              .and(validSubmission),
            // then set to used
            Bool(true),
            // else leave as it is
            masterOracleUsed);

          ix = ix.add(1);
        }

        // assert that there are valid values
        usedOraclesCount.assertGreaterThan(UInt32.zero);

        // sort values
        for (let i = 0; i < N-1; i++) {
          for (let j = i+1; j < N; j++) {
            let shouldSwap = values[i].greaterThan(values[j]);

            let bigger = Provable.if(shouldSwap, values[i], values[j]);
            let smaller = Provable.if(shouldSwap, values[j], values[i]);

            values[i] = smaller;
            values[j] = bigger;
          }
        }

        // index of the first valid price value
        const starting_i = UInt32.from(N).sub(usedOraclesCount);

        // compute the median of values[starting_i..]
        // rest == 1 -> odd case
        // quotient -> the mid-index
        const { quotient, rest } = usedOraclesCount.divMod(2);
        const firstMidIndex = starting_i.add(quotient.sub(1));  // 10 -> 4, 11 -> 4
        const secondMixIndex = starting_i.add(quotient);        // 10 -> 5, 11 -> 5
        // in the even case the median is (v[first] + v[second]) / 2 in the odd case it is just the second

        let the_median = UInt64.zero;

        ix = UInt32.zero;
        for (let i = 0; i < N; i++) {
          const v = values[i];

          // at firstMidIndex and even -> set the current value, otherwise just leave zero
          the_median = Provable.if(ix.equals(firstMidIndex).and(rest.equals(UInt32.zero)), v, the_median);
          the_median = Provable.if(
            // at secondMidIndex
            ix.equals(secondMixIndex),
            Provable.if(
              rest.equals(UInt32.zero),
              // even -> add the current value
              the_median.add(v),
              // odd -> add the current value > twice <.
              the_median.add(v).add(v)),
            // any other index -> leave as it is
            the_median);

          ix = ix.add(1);
        }

        // now divide.
        the_median = the_median.div(2);

        // set the median price
        minaPrice.priceNanoUSD = the_median;

        return {
          publicOutput: new PriceAggregationProofPublicOutput({
            minaPrice,
            usedOraclesHash,
            usedOraclesCount,
            masterOracleUsed
          }),
        };
      },
    },
  },
});

export {
  AggregateOraclePrices,
  PriceAggregationProofPrivateInput,
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
  PriceSubmission,
  OraclePriceSubmissions,
}
