import {
  CouncilUpdateActionEvent,
  EngineUpdateProposalPassedEvent,
  EngineUpdateProposalVoteEvent,
} from '../../../../system/council/events.js';
import { Signature, UInt32, PublicKey, Field } from 'o1js';
import { KeyPair } from '../../../../types/utility.js';
import {
  GovernanceUpdate,
  EngineUpdateVoteProof,
} from '../../../../proofs/engine-update/prove.js';
import { EngineUpdateSpec } from '../../../../system/engine-update/input.js';
import { TestHelper } from '../../../test-helper.js';
import { CouncilUpdateOperation } from '../../../../system/council/update/common.js';
import { ProposalMap } from '../../../../system/council/data/proposal-merkle-map.js';
import { ResolutionTree } from '../../../../system/council/data/resolution-tree.js';
import { CouncilMap } from '../../../../system/council/data/council-map.js';
import { Seat } from '../../../../system/council/seat.js';

export async function generateVoteProof(
  councilMember: KeyPair,
  councilMap: CouncilMap,
  seatKey: Field,
  govResolutionIndex: number = 0,
  updateSpec: EngineUpdateSpec = EngineUpdateSpec.empty()
): Promise<EngineUpdateVoteProof> {
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
    councilMap.provable,
    Seat.fromField(seatKey)
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
): ProposalMap {
  const proposalTree = new ProposalMap();

  const proposalEvents = events.filter(
    (event) => event.type === 'ProposalSupported'
  );

  for (const event of proposalEvents) {
    const eventData = event.event.data as EngineUpdateProposalVoteEvent;
    const proposalHash = eventData.updateHash as Field;
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
): ResolutionTree {
  const resolutionTree = new ResolutionTree();

  const resolutionEvents = events.filter(
    (event) => event.type === 'ProposalPassed'
  );

  for (const event of resolutionEvents) {
    const eventData = event.event.data as EngineUpdateProposalPassedEvent;
    const resolutionIndex = eventData.resolutionIndex.toBigint();
    const proposalHash = eventData.updateHash as Field;

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
): CouncilMap {
  const councilTree = new CouncilMap();

  console.log('Rebuilding Council Merkle Map');

  //Reverse the events array
  events.reverse();

  for (const event of events) {
    if (event.type === 'CouncilUpdateActionEvent') {
      const eventData = event.event.data as CouncilUpdateActionEvent;
      const action = eventData.action;

      if (action.shouldAdd) {
        councilTree.insertAtSeat(action.member, action.seat);
      } else {
        councilTree.insertAtSeat(PublicKey.fromBase58('0'), action.seat);
      }
    }
  }

  return councilTree;
}

/**
 * Extracts all council management operations from the given events.
 * @param events The array of contract events
 * @returns An array of CouncilUpdateOperation objects
 */
export function extractCouncilOperationsFromEvents(
  events: Array<{ type: string; event: { data: any } }>
): Array<CouncilUpdateOperation> {
  //Reverse the events array
  events.reverse();
  return events
    .filter((event) => event.type === 'CouncilUpdateActionEvent')
    .map((event) => event.event.data.action as CouncilUpdateOperation);
}

/**
 * Finds the index of the first empty leaf (hash equals zero) in the resolution Merkle tree.
 * Throws an error if no empty leaf is found.
 *
 * @param resolutionTree - The Merkle tree containing resolution entries.
 * @returns The index of the first empty leaf as a UInt32.
 */
export function getNextEmptyResolutionIndex(
  resolutionTree: ResolutionTree
): UInt32 {
  for (let i = 0n; i < resolutionTree.leafCount; i++) {
    const hash = resolutionTree.getLeaf(i);
    if (hash.toBigInt() === 0n) {
      return UInt32.from(i);
    }
  }
  throw new Error('Could not find an empty Resolution Index.');
}
