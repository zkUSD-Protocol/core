import {
  Bool,
  Field,
  Poseidon,
  Provable,
  SmartContract,
  State,
  method,
  Permissions,
  state,
  UInt8,
  Struct,
  MerkleMapWitness,
  Gadgets,
} from 'o1js';

import { ZkusdProtocolUpdateSpec } from '../system/governance-update/input.js';
import { ZkusdGovernanceUpdateVoteProof } from '../proofs/governance-update/prove.js';
import { ZkusdCouncilManagementVoteProof } from '../proofs/council-management/prove.js';

import {
  CouncilManagementActionEvent,
  CouncilManagementEvent,
  GovernanceProposalPassedEvent,
  GovernanceProposalSupportChangeEvent,
} from '../system/council-events.js';
import {
  ZkusdCouncilManagementActions,
  ZkusdCouncilManagementOperation,
} from '../system/council/management/input.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';
import { ProposalMap } from '../system/council/proposal-merkle-map.js';
import { CouncilMap } from '../system/council/council-map.js';

export class ZkUsdGovernmentContract extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.

  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionUpdateSpec: ZkusdProtocolUpdateSpec,
    resolutionWitness: ResolutionTree.Witness,
  ) {
    return Bool(false);
  }

  async deploy(args?: {
    verificationKey?: {
      data: string;
      hash: Field | string;
    };
  }): Promise<void> {
    super.deploy(args);
  }
}
type ZkUsdDeployArgs = {
  verificationKey?: {
    data: string;
    hash: Field | string;
  };
};

export class ProposalData extends Struct({
  proposedUpdate: ZkusdProtocolUpdateSpec,
  proposalVoteBitArray: Field,
}) {
  toFields(): Field[] {
    return [...this.proposedUpdate.toFields(), this.proposalVoteBitArray];
  }
}

export class ZkusdGoverningCouncilContract extends ZkUsdGovernmentContract {
  @state(Field) councilMerkleMapRoot = State<Field>();
  @state(Field) proposalsMerkleMapRoot = State<Field>();
  @state(Field) resolutionsMerkleRoot = State<Field>();
  @state(UInt8) votePassThreshold = State<UInt8>();

  static events = {
    ProposalSupported: GovernanceProposalSupportChangeEvent,
    ProposalPassed: GovernanceProposalPassedEvent,
    CouncilManagementEvent: CouncilManagementEvent,
    CouncilManagementActionEvent: CouncilManagementActionEvent,
  };
  readonly events = ZkusdGoverningCouncilContract.events;


  init() {
    super.init();
  }

  // a helper method that, coompute the valid merkle tree root.
  // this computation is not within provable code.
  async initialize(
    initialCouncilActions: ZkusdCouncilManagementActions,
    votePassThreshold: UInt8
  ) {
    const councilMerkleMap =
      CouncilMap.buildFromOperations(
        initialCouncilActions.actions
      );

    const councilMerkleMapRoot = councilMerkleMap.root;
    await this.initializeCouncilAndGov(
      councilMerkleMapRoot,
      initialCouncilActions,
      votePassThreshold
    );
  }

  // a method to initialize the contract it does not check if the merkle root
  // matches the provided keys, it is the caller's responsibility to do so.
  // preferably use the `initializeWithKeys` method.
  @method
  async initializeCouncilAndGov(
    councilMerkleMapRoot: Field,
    initialCouncilActions: ZkusdCouncilManagementActions,
    votePassThreshold: UInt8
  ) {
    const proposalsMerkleMapRoot = new ProposalMap()
    const resolutionMerkleRoot = new ResolutionTree()
    this.councilMerkleMapRoot.set(councilMerkleMapRoot);
    this.votePassThreshold.set(votePassThreshold);
    this.proposalsMerkleMapRoot.set(proposalsMerkleMapRoot.getRoot());
    this.resolutionsMerkleRoot.set(resolutionMerkleRoot.getRoot());

    this.emitEvent(
      'CouncilManagementEvent',
      new CouncilManagementEvent({
        councilMerkleMapRoot,
        votePassThreshold,
      })
    );

    for (let i = 0; i < ZkusdCouncilManagementActions.MaxLength; i++) {
      this.emitEventIf(
        initialCouncilActions.actions[i].isDummy.not(),
        'CouncilManagementActionEvent',
        new CouncilManagementActionEvent({
          action: initialCouncilActions.actions[i],
        })
      );
    }
  }

  async deploy(args?: ZkUsdDeployArgs): Promise<void> {
    await super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
      receive: Permissions.none(),
      setDelegate: Permissions.signature(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.VerificationKey.signature(),
      setZkappUri: Permissions.signature(),
      editActionState: Permissions.proof(),
      setTokenSymbol: Permissions.signature(),
    });
  }

  // try to pass proposal by giving the witnesses necessary to check if
  // reached the required councik support.
  @method
  async passProposal(
    updateSpec: ZkusdProtocolUpdateSpec,
    proposalWitness: MerkleMapWitness,
    proposalCurrentVoteBitArray: Field,
    resolutionWitness: ResolutionTree.Witness
  ) {
    // get the current proposal vote bit array
    // the witness should account for the current state of things
    const proposalMerkleRoot =
      this.proposalsMerkleMapRoot.getAndRequireEquals();
    const [proposalRootBefore, computedKey] = proposalWitness.computeRootAndKey(
      proposalCurrentVoteBitArray
    );
    // the root and key should match
    proposalRootBefore.assertEquals(
      proposalMerkleRoot,
      'Invalid proposal witness or the vote bit array is not up-to-date. Computed root mismatch.'
    );
    // the computed key should match the proposal key
    computedKey.assertEquals(
      Poseidon.hash(updateSpec.toFields()),
      'Invalid proposal witness or the vote bit array is not up-to-date. Computed key mismatch.'
    );

    // check if resolution index is not already used
    const resolutionsMerkleRoot =
      this.resolutionsMerkleRoot.getAndRequireEquals();
    const computedResolutionIndex = resolutionWitness.calculateIndex();
    computedResolutionIndex.assertEquals(
      updateSpec.govResolutionIndex.value,
      'Invalid resolution witness'
    );
    const proposalHash = Poseidon.hash(updateSpec.toFields());
    resolutionWitness
      .calculateRoot(Field.from(0))
      .assertEquals(resolutionsMerkleRoot, 'Invalid resolution witness');

    // now check if the vote count is above the threshold
    const threshold = this.votePassThreshold.getAndRequireEquals();
    const bits = proposalCurrentVoteBitArray.toBits();
    let voteCount = Field.from(0);
    for (let i = 0; i < CouncilMap.SEAT_LIMIT; i++) {
      voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
    }
    // voteCount should be equal to or above the threshold
    voteCount.assertGreaterThanOrEqual(
      threshold.value,
      'Vote count is below the threshold'
    );

    // recompute the root and set it and thus enable executing the resolution
    const newResolutionRoot = resolutionWitness.calculateRoot(proposalHash);

    this.resolutionsMerkleRoot.set(newResolutionRoot);

    this.emitEvent(
      'ProposalPassed',
      new GovernanceProposalPassedEvent({
        proposalHash,
        resolutionIndex: updateSpec.govResolutionIndex,
        resolutionTreeRootBefore: resolutionsMerkleRoot
      })
    );
  }

  async supportProposalHelper(
    voteProof: ZkusdGovernanceUpdateVoteProof,
    proposalMap: ProposalMap,
    resolutionTree: ResolutionTree
  ) {
    const proposalWitness = proposalMap.getWitness(
      voteProof.publicOutput.proposalHash
    );
    const resolutionWitness = resolutionTree.getWitnessWrapped(
        voteProof.publicInput.govResolutionIndex.toBigint()
    );
    const proposalCurrentVoteBitArray = proposalMap.get(
      voteProof.publicOutput.proposalHash
    );
    return await this.supportProposal(
      voteProof,
      proposalWitness,
      proposalCurrentVoteBitArray,
      resolutionWitness
    );
  }


  // This method allows to create and cast a vote for a proposal
  // it will sum (safely) the given vote with the current support
  @method
  async supportProposal(
    voteProof: ZkusdGovernanceUpdateVoteProof,
    proposalWitness: MerkleMapWitness,
    proposalCurrentVoteBitArray: Field,
    resolutionWitness: ResolutionTree.Witness
  ) {
    voteProof.verify();

    const { proposalHash, councilMerkleMapRoot, cummulatedVoteBitArray } =
      voteProof.publicOutput;

    this.councilMerkleMapRoot
      .getAndRequireEquals()
      .assertEquals(councilMerkleMapRoot, 'Invalid member witness');

    // get the current proposal vote bit array
    // the witness should account for the current state of things
    const proposalMerkleRoot =
      this.proposalsMerkleMapRoot.getAndRequireEquals();
    const [proposalRootBefore, computedKey] = proposalWitness.computeRootAndKey(
      proposalCurrentVoteBitArray
    );
    // the root and key should match
    proposalRootBefore.assertEquals(
      proposalMerkleRoot,
      'Invalid proposal witness or the vote bit array is not up-to-date'
    );
    // the computed key should match the proposal key
    computedKey.assertEquals(
      proposalHash,
      'Invalid proposal witness or the vote bit array is not up-to-date'
    );

    const newVoteBitArray = Gadgets.or(
      proposalCurrentVoteBitArray,
      cummulatedVoteBitArray,
      CouncilMap.SEAT_LIMIT
    );

    // recompute the root
    const [newProposalsRoot] =
      proposalWitness.computeRootAndKey(newVoteBitArray);

    // check if resolution index is not already used
    // technically it is not necessary but allows to fail early and avoid voting on a broken resolution
    const resolutionsMerkleRoot =
      this.resolutionsMerkleRoot.getAndRequireEquals();
    const computedResolutionIndex = resolutionWitness.calculateIndex();
    computedResolutionIndex.assertEquals(
      voteProof.publicInput.govResolutionIndex.value,
      'Invalid resolution witness'
    );
    resolutionWitness
      .calculateRoot(Field.from(0))
      .assertEquals(resolutionsMerkleRoot, 'Invalid resolution witness');

    // set the root and thus enable voting on the proposal
    this.proposalsMerkleMapRoot.set(newProposalsRoot);

    this.emitEventIf(
      // the proposal root was changed
      proposalMerkleRoot.equals(newProposalsRoot).not(),
      'ProposalSupported',
      new GovernanceProposalSupportChangeEvent({
        proposalMapRootBefore: proposalMerkleRoot,
        acceptedVoteBitArray: newVoteBitArray,
        proposalHash,
        resolutionIndex: voteProof.publicInput.govResolutionIndex,
      })
    );
  }

  /** Admin signature proofs can be executed iff:
      the vk key matches one pinned to the on-chain state of this contract.
      The contract admin public matches the one in the output of the proof:
      See: `AdminSignatureZkusdProtocolUpdateProgram` output.
      The `zkMethodCode` is explicitly permited by this contract.
  */
  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    updateSpec: ZkusdProtocolUpdateSpec,
    resolutionWitness: ResolutionTree.Witness
  ) {
    // check if the resolution is present in the currently pinned resolutions tree
    const resolutionsMerkleRoot =
      this.resolutionsMerkleRoot.getAndRequireEquals();
    const computedResolutionIndex = resolutionWitness.calculateIndex();
    computedResolutionIndex.assertEquals(
      updateSpec.govResolutionIndex.value,
      'Invalid resolution witness'
    );
    resolutionWitness
      .calculateRoot(Poseidon.hash(updateSpec.toFields()))
      .assertEquals(resolutionsMerkleRoot, 'Invalid resolution witness');
    return Bool(true);
  }

  checkVoteCountAboveThreshold(voteBitArray: Field) {
    const threshold = this.votePassThreshold.getAndRequireEquals();
    const bits = voteBitArray.toBits();
    let voteCount = Field.from(0);
    for (let i = 0; i < CouncilMap.SEAT_LIMIT; i++) {
      voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
    }

    voteCount.assertGreaterThanOrEqual(
      threshold.value,
      'Vote count is below threshold'
    );
  }

  @method async executeZkusdCouncilManagementActions(
    councilManagementVoteProof: ZkusdCouncilManagementVoteProof
  ) {
    //verify the vote proof
    councilManagementVoteProof.verify();

    // get the vote bit array and root used from the proof
    const voteBitArray =
      councilManagementVoteProof.publicOutput.cummulatedVoteBitArray;
    const councilMerkleMapRoot =
      councilManagementVoteProof.publicInput.currentCouncilMap.root;

    // verify the council member merkle root
    this.councilMerkleMapRoot
      .getAndRequireEquals()
      .assertEquals(councilMerkleMapRoot, 'Invalid council member merkle root');

    // check if the vote count is above the threshold
    this.checkVoteCountAboveThreshold(voteBitArray);

    //Update the new council merkle root
    const updatedcouncilMerkleMapRoot =
      councilManagementVoteProof.publicOutput.updatedCouncilMap.root;
    const newVoteThreshold =
      councilManagementVoteProof.publicInput.councilManagementSpec
        .newVoteThreshold;

    this.councilMerkleMapRoot.set(updatedcouncilMerkleMapRoot);
    this.votePassThreshold.set(newVoteThreshold);

    this.emitEvent(
      'CouncilManagementEvent',
      new CouncilManagementEvent({
        councilMerkleMapRoot: updatedcouncilMerkleMapRoot,
        votePassThreshold: newVoteThreshold,
      })
    );

    for (let i = 0; i < ZkusdCouncilManagementActions.MaxLength; i++) {
      this.emitEventIf(
        councilManagementVoteProof.publicInput.councilManagementSpec.councilManagementActions.actions[
          i
        ].isDummy.not(),
        'CouncilManagementActionEvent',
        new CouncilManagementActionEvent({
          action:
            councilManagementVoteProof.publicInput.councilManagementSpec
              .councilManagementActions.actions[i],
        })
      );
    }
  }
}

export function countBits(x: Field): UInt8 {
  const bits = x.toBits();
  let voteCount = Field.from(0);
  for (let i = 0; i < CouncilMap.SEAT_LIMIT; i++) {
    voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
  }
  const ret = UInt8.Unsafe.fromField(voteCount);
  return ret;
}
