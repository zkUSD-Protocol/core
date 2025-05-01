import { Field, Struct } from 'o1js';
import { CouncilMapProvable } from '../data/council-map.js';

/**
 * Represents the output of a council update vote operation used as the PublicOutput of the proof.
 * Contains the updated council map and the cumulative vote information.
 *
 * This structure is used to track the results of voting on council updates
 * and provides the necessary information for verification and follow-up operations.
 */
export class CouncilUpdateVoteOutput extends Struct({
  /**
   * The updated council map after applying the approved changes.
   * This represents the new state of the council membership.
   */
  updatedCouncilMap: CouncilMapProvable,

  /**
   * A bit array encoded as a Field representing which council members have voted.
   * Each bit position corresponds to a council seat index, where:
   * - A bit value of 1 indicates that the council member at that seat has voted in favor
   * - A bit value of 0 indicates that the council member at that seat has not voted
   *
   * This cumulative array is used to track votes across multiple transactions
   * and to determine when a proposal has reached the required threshold.
   */
  cummulatedVoteBitArray: Field,
}) {}
