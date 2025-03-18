import { Field, MerkleWitness, Struct } from 'o1js';

// TODO
export class IpnsAddr extends Struct({
  field1: Field,
  field2: Field,
}) {}

export const ZKUSD_GOV_RESOLUTION_PROGRAMS_TREE_HEIGHT = 12; // 4096 programs

export class ZkusdGovResolutionProgramWitness extends MerkleWitness(
  ZKUSD_GOV_RESOLUTION_PROGRAMS_TREE_HEIGHT
) {}
