import {
  DynamicProof,
  Field,
  Struct,
  UInt32,
  VerificationKey,
  verify,
} from 'o1js';

import { AggregateOraclePricesProof } from './prove.js';

/**
 * @notice Input structure for Mina price verification
 */
class MinaPriceInput extends Struct({
  proof: AggregateOraclePricesProof,
  verificationKey: VerificationKey,
}) {}

/**
 * @notice Verify Mina price input
 */
const verifyMinaPriceInput = async (args: {
  input: MinaPriceInput;
  oracleWhitelistHash: Field;
  currentBlockHeight: UInt32;
  proofVkHash: Field;
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

  input.proof.publicInput.currentBlockHeight.assertEquals(currentBlockHeight);

  input.proof.verify();
};

export { MinaPriceInput, verifyMinaPriceInput };
