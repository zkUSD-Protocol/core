import { Field, Struct, UInt32, UInt8 } from 'o1js';
import { ZkusdCouncilManagementOperation } from './council/management/input.js';

export class GovernanceProposalSupportChangeEvent extends Struct({
  proposalMapRootBefore: Field,
  acceptedVoteBitArray: Field,
  proposalHash: Field,
  resolutionIndex: UInt32,
}) {}

export class GovernanceProposalPassedEvent extends Struct({
  resolutionTreeRootBefore: Field,
  proposalHash: Field,
  resolutionIndex: UInt32,
}) {}

export class CouncilManagementEvent extends Struct({
  councilMerkleMapRoot: Field,
  votePassThreshold: UInt8,
}) {}

export class CouncilManagementActionEvent extends Struct({
  action: ZkusdCouncilManagementOperation,
}) {}
