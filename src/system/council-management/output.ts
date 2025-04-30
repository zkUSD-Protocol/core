import { Field, Struct } from 'o1js';
import { ZkusdCouncilMerkleMap } from '../../proofs/council-management/common.js';

export class ZkusdCouncilManagementOutput extends Struct({
  updatedCouncilMap: ZkusdCouncilMerkleMap,
  cummulatedVoteBitArray: Field,
}) {}
