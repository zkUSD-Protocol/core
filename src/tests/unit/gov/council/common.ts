import {
  CouncilProposalPassedEvent,
  CouncilProposalSupportChangeEvent,
  getNewCouncilMembers,
} from '../../../../system/council-events.js';
import { MerkleMap, Field, MerkleTree, Signature, UInt32 } from 'o1js';
import { KeyPair } from '../../../../types/utility.js';
import {
  MultiSigZkusdProtocolUpdateProgram,
  ZkusdCouncilMemberWitness,
  ZkusdGoverningCouncilVoteProof,
} from '../../../../proofs/gov/council-multisig.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
import { TestHelper } from '../../../test-helper.js';
import { ZkusdGoverningCouncilContract } from '../../../../contracts/zkusd-governing-council.js';
import { ZKUSD_GOV_UPDATE_TREE_HEIGHT } from '../../../../system/governance.js';

export async function generateVoteProof(
  councilMember: KeyPair,
  councilTree: MerkleTree,
  seatIndex: number,
  govResolutionIndex: number = 0,
  updateSpec: ZkusdProtocolUpdateSpec = ZkusdProtocolUpdateSpec.empty()
): Promise<ZkusdGoverningCouncilVoteProof> {
  // an example of a update - an empty one, but its okay for these tests.
  updateSpec.govResolutionIndex = UInt32.from(govResolutionIndex);
  const updateInputFields = updateSpec.toFields();
  const signature = Signature.create(
    councilMember.privateKey,
    updateInputFields
  );

  const witness = new ZkusdCouncilMemberWitness(
    councilTree.getWitness(BigInt(seatIndex))
  );

  console.log('Creating vote (correct signature, correct membership)...');
  const { proof } = await MultiSigZkusdProtocolUpdateProgram.createVote(
    updateSpec,
    signature,
    councilMember.publicKey,
    witness,
    councilTree.getRoot(),
    Field(2 ** seatIndex) // The seat index is encoded as 2^index
  );
  return proof;
}

/**
 * Rebuilds the Proposal MerkleMap from Council ProposalSupported events.
 * @param events Array of all contract events fetched from the council contract
 * @returns The reconstructed MerkleMap of proposals
 */
export function rebuildProposalMerkleMap(
  events: Array<{ type: string; event: { data: any } }>
): MerkleMap {
  const proposalTree = new MerkleMap();

  const proposalEvents = events.filter(
    (event) => event.type === 'ProposalSupported'
  );

  for (const event of proposalEvents) {
    const eventData = event.event.data as CouncilProposalSupportChangeEvent;
    const proposalHash = eventData.proposalHash as Field;
    const acceptedVotes = eventData.acceptedVoteBitArray as Field;

    const previousVotes = proposalTree.get(proposalHash);

    // Update only if the new vote bit array has more support
    if (acceptedVotes.greaterThan(previousVotes).toBoolean()) {
      proposalTree.set(proposalHash, acceptedVotes);
    }
  }

  return proposalTree;
}

/**
 * Rebuilds the Resolution MerkleTree from Council ProposalPassed events.
 * @param events Array of all contract events fetched from the council contract
 * @param treeHeight Height of the MerkleTree (default = 32)
 * @returns The reconstructed MerkleTree of resolutions
 */
export function rebuildResolutionMerkleTree(
  events: Array<{ type: string; event: { data: any } }>
): MerkleTree {
  const resolutionTree = new MerkleTree(ZKUSD_GOV_UPDATE_TREE_HEIGHT);

  const resolutionEvents = events.filter(
    (event) => event.type === 'ProposalPassed'
  );

  for (const event of resolutionEvents) {
    const eventData = event.event.data as CouncilProposalPassedEvent;
    const resolutionIndex = eventData.resolutionIndex.toBigint();
    const proposalHash = eventData.proposalHash as Field;

    resolutionTree.setLeaf(resolutionIndex, proposalHash);
  }

  return resolutionTree;
}

export async function prepareCouncilMembers(th: TestHelper<'local'>) {
  if (
    th.networkKeys.council === undefined ||
    th.networkKeys.council.length === 0
  ) {
    throw new Error('Council keys are not defined');
  }
  return th.networkKeys.council;
}
/**
 * Rebuilds the Council PublicKey list and MerkleTree from contract events.
 * @param events The array of council contract events (emitted during lifetime)
 * @returns Object containing: members (PublicKey[]), and the reconstructed MerkleTree
 */
export function rebuildCouncilMembersAndTree(
  events: Array<{ type: string; event: { data: any } }>
) {
  const councilKeys = getNewCouncilMembers(events);
  const councilTree =
    ZkusdGoverningCouncilContract.buildCouncilMerkleTree(councilKeys);
  return { councilKeys, councilTree };
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
