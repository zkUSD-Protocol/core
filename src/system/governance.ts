import { Field, MerkleTree, MerkleWitness, PublicKey, Struct, UInt32 } from 'o1js';
import { ZkUsdGovernmentPoc } from '../contracts/zkusd-government-poc';

// TODO
export class IpnsAddr extends Struct({
  field1: Field,
  field2: Field,
}) {}

export const ZKUSD_GOV_RESOLUTION_PROGRAMS_TREE_HEIGHT = 12; // 4096 programs

export class ZkusdGovResolutionProgramWitness extends MerkleWitness(
  ZKUSD_GOV_RESOLUTION_PROGRAMS_TREE_HEIGHT
) {}

export const mkZkusdGovResolutionProgramTree = () =>
  new MerkleTree(ZKUSD_GOV_RESOLUTION_PROGRAMS_TREE_HEIGHT);

export type ZkUsdGovernmentPocConstructor = new (
  address: PublicKey
) => ZkUsdGovernmentPoc;


export const NO_RESOLUTION_INDEX = UInt32.from(4200000000);
