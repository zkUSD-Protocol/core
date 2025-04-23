import { Field, MerkleTree, UInt32 } from 'o1js';
import { CouncilProposalPassedEvent } from '../system/council/events.js';
import { ZkusdGoverningCouncilContract } from '../contracts/zkusd-governing-council.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';

export interface IResolutionMerkleTreeProvider {
  getNextEmptyResolutionIndex(): Promise<UInt32>;
  getResolutionMerkleTree(): Promise<MerkleTree>;
}

export class ContractEventsResolutionMerkleTreeProvider
  implements IResolutionMerkleTreeProvider
{
  constructor(private councilContract: ZkusdGoverningCouncilContract) {}

  async getNextEmptyResolutionIndex(): Promise<UInt32> {
    const tree = await this.getResolutionMerkleTree();
    return getNextEmptyResolutionIndex(tree);
  }

  async getResolutionMerkleTree(): Promise<MerkleTree> {
    const events = await this.councilContract.fetchEvents();
    return rebuildResolutionMerkleTree(events);
  }
}

/*
 * Rebuilds the Resolution MerkleTree from Council ProposalPassed events.
 * @param events Array of all contract events fetched from the council contract
 * @param treeHeight Height of the MerkleTree (default = 32)
 * @returns The reconstructed MerkleTree of resolutions
 */
export function rebuildResolutionMerkleTree(
  events: Array<{ type: string; event: { data: any } }>
): MerkleTree {
  const resolutionTree = new ResolutionTree();

  const resolutionEvents = events.filter(
    (event) => event.type === 'ProposalPassed'
  );
  for (const event of resolutionEvents) {
    const eventData = event.event.data as CouncilProposalPassedEvent;
    const resolutionIndex = eventData.resolutionIndex.toBigint();
    const proposalHash = eventData.updateHash as Field;

    resolutionTree.setLeaf(resolutionIndex, proposalHash);
  }

  return resolutionTree;
}

/**
 * Finds the index of the first empty leaf (hash equals zero) in the resolution Merkle tree.
 * Throws an error if no empty leaf is found.
 *
 * @param resolutionTree - The Merkle tree containing resolution entries.
 * @returns The index of the first empty leaf as a UInt32.
 */
export function getNextEmptyResolutionIndex(
  resolutionTree: MerkleTree
): UInt32 {
  for (let i = 0n; i < resolutionTree.leafCount; i++) {
    const hash = resolutionTree.getLeaf(i);
    if (hash.toBigInt() === 0n) {
      return UInt32.from(i);
    }
  }
  throw new Error('Could not find an empty Resolution Index.');
}
