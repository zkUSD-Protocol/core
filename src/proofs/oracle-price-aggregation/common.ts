import { Field, Provable, Struct, UInt32, PublicKey, Bool, UInt64 } from 'o1js';

import { MinaPrice, OracleWhitelist } from '../../types.js';

/**
 * @notice Input data structure for price aggregation proof
 */
class PriceAggregationProofPublicInput extends Struct({
  currentBlockHeight: UInt32,
  oracleWhitelistHash: Field,
}) {}

class ValidSubmission extends Struct({
  publicKey: PublicKey,
  submissionValid: Bool,
}) {
  static empty(): ValidSubmission {
    return new ValidSubmission({
      publicKey: PublicKey.empty(),
      submissionValid: Bool(false),
    });
  }
}

/**
 * @notice Collection of public keys of whitelist oracles along information
           about their submission validity.
 */
class ValidSubmissions extends Struct({
  valid: Provable.Array(ValidSubmission, OracleWhitelist.MAX_PARTICIPANTS),
  count: UInt32,
}) {
  static empty(): ValidSubmissions {
    return new ValidSubmissions({
      valid: Array(OracleWhitelist.MAX_PARTICIPANTS).fill(
        ValidSubmission.empty()
      ),
      count: UInt32.from(0),
    });
  }
}

/**
 * @notice Output data structure from price aggregation proof
 */
class PriceAggregationProofPublicOutput extends Struct({
  minaPrice: MinaPrice,
  validSubmissions: ValidSubmissions,
}) {}

export {
  ValidSubmission,
  ValidSubmissions,
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
};
