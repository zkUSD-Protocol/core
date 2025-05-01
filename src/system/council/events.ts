import { Field, Struct, UInt32, UInt8 } from 'o1js';
import { CouncilUpdateOperation } from './update/input.js';

export class EngineUpdateProposalVoteEvent extends Struct({
  proposalMapRootBefore: Field,
  acceptedVoteBitArray: Field,
  updateHash: Field,
  resolutionIndex: UInt32,
}) {}

export class EngineUpdateProposalPassedEvent extends Struct({
  resolutionTreeRootBefore: Field,
  updateHash: Field,
  resolutionIndex: UInt32,
}) {}

export class CouncilUpdateEvent extends Struct({
  councilMerkleMapRoot: Field,
  votePassThreshold: UInt8,
}) {}

export class CouncilUpdateActionEvent extends Struct({
  action: CouncilUpdateOperation,
}) {}
