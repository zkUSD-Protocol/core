import { Field, Struct } from 'o1js';


/**
 * Output of the proof, including whether it's final or not.
 */
export class ZkusdProtocolUpdateOutput extends Struct({
  proposalHash: Field,
  councilMemberMerkleRoot: Field,
  cummulatedVoteBitArray: Field,
}) {}
