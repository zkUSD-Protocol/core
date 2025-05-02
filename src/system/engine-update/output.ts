import { Field, Struct } from 'o1js';

/**
 * Output structure for a ZKUSD protocol update proof.
 *
 * Contains critical fields summarizing the state after a protocol update proposal.
 *
 * Properties:
 * - `proposalHash` — `Field`: Hash of the proposal specifications.
 * - `councilMerkleMapRoot` — `Field`: Merkle root of the council members after the update.
 * - `cummulatedVoteBitArray` — `Field`: Bit array encoding accumulated votes.
 */
export class EngineUpdateOutput extends Struct({
  /**
   * Computed hash representing the proposed update specification.
   */
  proposalHash: Field,

  /**
   * Merkle root of the council members set.
   */
  councilMerkleMapRoot: Field,

  /**
   * Bit array (stored as a Field) encoding the accumulated votes.
   */
  cummulatedVoteBitArray: Field,
}) {}
