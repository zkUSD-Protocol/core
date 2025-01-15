import {
  Bool,
  DynamicProof,
  Field,
  Provable,
  Struct,
  UInt32,
  VerificationKey,
} from 'o1js';

import {
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput
} from './common.js';

/**
 * @notice The proof type of the oracle price aggregation program.
 */
class PriceAggregationProof extends DynamicProof<
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput
> {
  static publicInputType = PriceAggregationProofPublicInput;
  static publicOutputType = PriceAggregationProofPublicOutput;
}

/**
 * @notice Input structure for Mina price verification
 */
class MinaPriceInput extends Struct({
  proof: PriceAggregationProof,
  verificationKey: VerificationKey,
}) {}

/**
 * @notice Verify Mina price input
 */
const verifyMinaPriceInput = async (args: {
  input: MinaPriceInput;
  oracleWhitelistHash: Field;
  currentBlockHeight: UInt32;
  masterOracleRequiredThreshold: UInt32;
  proofVkHash: Field;
}) => {
  const {
    input,
    oracleWhitelistHash,
    proofVkHash,
    currentBlockHeight,
    masterOracleRequiredThreshold
  } = args;

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

  const usedOraclesCount = input.proof.publicOutput.usedOraclesCount;
  const masterOracleUsed = input.proof.publicOutput.masterOracleUsed;

  const masterOracleUseValid = Provable.if(
    usedOraclesCount.lessThan(masterOracleRequiredThreshold),
    masterOracleUsed,
    Bool(true),
  );

  masterOracleUseValid.assertTrue(
    `A valid master oracle submission should be present in the proof when only ${input.proof.publicOutput.usedOraclesCount} valid submissions.`);

  input.proof.verify(input.verificationKey);
};

export {
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
  PriceAggregationProof,
  MinaPriceInput,
  verifyMinaPriceInput,
};
