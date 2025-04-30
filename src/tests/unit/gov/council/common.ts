import {
  CouncilManagementActionEvent,
  GovernanceProposalPassedEvent,
  GovernanceProposalSupportChangeEvent,
} from '../../../../system/council-events.js';
import {
  MerkleMap,
  Field,
  MerkleTree,
  Signature,
  UInt32,
  Poseidon,
} from 'o1js';
import { KeyPair } from '../../../../types/utility.js';
import {
  GovernanceUpdate,
  ZkusdGovernanceUpdateVoteProof,
} from '../../../../proofs/governance-update/prove.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/governance-update/input.js';
import { TestHelper } from '../../../test-helper.js';
import { ZkusdGoverningCouncilContract } from '../../../../contracts/zkusd-governing-council.js';
import { ZKUSD_GOV_UPDATE_TREE_HEIGHT } from '../../../../system/governance.js';
import { ZkusdCouncilMerkleMap } from '../../../../proofs/council-management/common.js';
import { ZkusdCouncilManagementOperation } from '../../../../system/council-management/input.js';

export async function generateVoteProof(
  councilMember: KeyPair,
  councilMerkleMap: ZkusdCouncilMerkleMap,
  seatIndex: number,
  govResolutionIndex: number = 0,
  updateSpec: ZkusdProtocolUpdateSpec = ZkusdProtocolUpdateSpec.empty()
): Promise<ZkusdGovernanceUpdateVoteProof> {
  // an example of a update - an empty one, but its okay for these tests.
  updateSpec.govResolutionIndex = UInt32.from(govResolutionIndex);
  const updateInputFields = updateSpec.toFields();
  const signature = Signature.create(
    councilMember.privateKey,
    updateInputFields
  );

  const { proof } = await GovernanceUpdate.createVote(
    updateSpec,
    signature,
    councilMember.publicKey,
    councilMerkleMap,
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
    const eventData = event.event.data as GovernanceProposalSupportChangeEvent;
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
    const eventData = event.event.data as GovernanceProposalPassedEvent;
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
 * Rebuilds the Council MerkleMap from contract events.
 * @param events The array of council contract events (emitted during lifetime)
 * @returns The reconstructed MerkleMap
 */
export function rebuildCouncilMerkleMap(
  events: Array<{ type: string; event: { data: any } }>
): ZkusdCouncilMerkleMap {
  const councilTree = new ZkusdCouncilMerkleMap();

  console.log('Rebuilding Council Merkle Map');

  //Reverse the events array
  events.reverse();

  for (const event of events) {
    if (event.type === 'CouncilManagementActionEvent') {
      const eventData = event.event.data as CouncilManagementActionEvent;
      const action = eventData.action;

      if (action.shouldAdd) {
        councilTree.set(
          action.councilSeatPosition,
          Poseidon.hash(action.councilKey.toFields())
        );
      } else {
        councilTree.set(action.councilSeatPosition, Field.from(0));
      }
    }
  }

  return councilTree;
}

/**
 * Extracts all council management operations from the given events.
 * @param events The array of contract events
 * @returns An array of ZkusdCouncilManagementOperation objects
 */
export function extractCouncilOperationsFromEvents(
  events: Array<{ type: string; event: { data: any } }>
): Array<ZkusdCouncilManagementOperation> {
  return events
    .filter((event) => event.type === 'CouncilManagementActionEvent')
    .map((event) => event.event.data.action as ZkusdCouncilManagementOperation);
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
