import { Field, Provable, PublicKey, Struct, UInt32, UInt8 } from 'o1js';
import { InitialCouncilMembers } from './governance.js';
import {
  ZkusdCouncilManagementActions,
  ZkusdCouncilManagementOperation,
} from './council-management/input.js';

export class GovernanceProposalSupportChangeEvent extends Struct({
  proposalTreeRootBefore: Field,
  acceptedVoteBitArray: Field,
  proposalHash: Field,
  resolutionIndex: UInt32,
}) {}

export class GovernanceProposalPassedEvent extends Struct({
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
