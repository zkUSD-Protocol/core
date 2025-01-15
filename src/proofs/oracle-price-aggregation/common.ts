import {
  Bool,
  Field,
  Struct,
  UInt32,
} from 'o1js';

import {
  MinaPrice,
} from '../../types.js';


/**
 * @notice Input data structure for price aggregation proof
 */
class PriceAggregationProofPublicInput extends Struct({
  currentBlockHeight: UInt32,
  oracleWhitelistHash: Field,
}) {}

/**
 * @notice Output data structure from price aggregation proof
 */
class PriceAggregationProofPublicOutput extends Struct({
  minaPrice: MinaPrice,
  usedOraclesHash: Field,
  usedOraclesCount: UInt32,
  masterOracleUsed: Bool,
}) {}

export {
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput,
};
