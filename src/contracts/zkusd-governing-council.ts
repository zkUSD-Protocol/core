import {
  Bool,
  Field,
  Poseidon,
  Provable,
  State,
  method,
  Permissions,
  state,
  UInt8,
  MerkleMapWitness,
  PublicKey,
} from 'o1js';

import {
  InitialCouncilMembers,
} from '../system/governance.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import {
  ZkusdGoverningCouncilVoteProof,
} from '../proofs/gov/council-multisig.js';
import {
  CouncilProposalPassedEvent,
  CouncilProposalSupportChangeEvent,
  NewCouncilInitializedWithFixedKeysEvent,
} from '../system/council/events.js';
import { ensureMinArrayLength } from '../utils/array.js';
import { ZkUsdDeployArgs, ZkUsdGovernmentContract } from './zkusd-base-gov-contract.js';
import { ProposalMap } from '../system/council/proposal-merkle-map.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';
import { CouncilTree } from '../system/council/council-tree.js';

export class ZkusdGoverningCouncilContract extends ZkUsdGovernmentContract {
  @state(Field) councilMembersMerkleRoot = State<Field>();
  @state(Field) proposalsMerkleMapRoot = State<Field>();
  @state(Field) resolutionsMerkleRoot = State<Field>();
  @state(UInt8) standardProposalPassThreshold = State<UInt8>();

  static events = {
    ProposalSupported: CouncilProposalSupportChangeEvent,
    ProposalPassed: CouncilProposalPassedEvent,
    NewCouncilInitializedWithFixedKeys: NewCouncilInitializedWithFixedKeysEvent,
  }

  readonly events = ZkusdGoverningCouncilContract.events;

  init() {
    super.init();
  }

  assertValidCouncilTreeRoot(councilTree: CouncilTree) {
    const councilMembersMerkleRoot =
      this.councilMembersMerkleRoot.getAndRequireEquals();
    const currentCouncilMembersMerkleRoot = councilTree.getRoot();
    currentCouncilMembersMerkleRoot.assertEquals(
      councilMembersMerkleRoot,
      'Invalid council members tree'
    );
  }

  // a helper method that, coompute the valid merkle tree root.
  // this computation is not within provable code.
  async initializeWithKeys(
    councilMembers: PublicKey[],
    standardProposalPassThreshold: UInt8
  ) {
    if (councilMembers.length > InitialCouncilMembers.MaxLength) {
      throw new Error(
        `Can only initialize with ${InitialCouncilMembers.MaxLength} members`
      );
    }

    const councilMembersProvableArray = ensureMinArrayLength(
      councilMembers,
      InitialCouncilMembers.MaxLength,
      PublicKey.empty()
    );
    const councilTree = new CouncilTree(councilMembers);

    await this.initializeWithCouncilMembersKeys(
      councilTree.getRoot(),
      new InitialCouncilMembers({
        councilMembers: councilMembersProvableArray,
      }),
      standardProposalPassThreshold
    );
  }

  // a method to initialize the contract it does not check if the merkle root
  // matches the provided keys, it is the caller's responsibility to do so.
  // preferably use the `initializeWithKeys` method.
  @method
  async initializeWithCouncilMembersKeys(
    councilMerkleRoot: Field,
    councilMembers: InitialCouncilMembers,
    standardProposalPassThreshold: UInt8
  ) {
    const proposalsMerkleMapRoot = new ProposalMap();
    const resolutionMerkleRoot = new ResolutionTree();
    this.councilMembersMerkleRoot.set(councilMerkleRoot);
    this.standardProposalPassThreshold.set(standardProposalPassThreshold);
    this.proposalsMerkleMapRoot.set(proposalsMerkleMapRoot.getRoot());
    this.resolutionsMerkleRoot.set(resolutionMerkleRoot.getRoot());

    this.emitEvent(
      'NewCouncilInitializedWithFixedKeys',
      new NewCouncilInitializedWithFixedKeysEvent({
        councilMerkleRoot,
        councilMembers,
      })
    );
  }

  async deploy(args?: ZkUsdDeployArgs): Promise<void> {
    await super.deploy(args);
    // TODO switch from the default to hardcoded permissions
    this.account.permissions.set({
      ...Permissions.default(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.VerificationKey.signature(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
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
    const updateHash = Poseidon.hash(updateSpec.toFields());
    resolutionWitness
      .calculateRoot(Field.from(0))
      .assertEquals(resolutionsMerkleRoot, 'Invalid resolution witness');

    // now check if the vote count is above the threshold
    const threshold = this.standardProposalPassThreshold.getAndRequireEquals();
    const bits = proposalCurrentVoteBitArray.toBits();
    let voteCount = Field.from(0);
    for (let i = 0; i < CouncilTree.MAX_SIZE; i++) {
      voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
    }
    // voteCount should be equal to or above the threshold
    voteCount.assertGreaterThanOrEqual(
      threshold.value,
      'Vote count is below the threshold'
    );

    // recompute the root and set it and thus enable executing the resolution
    const newResolutionRoot = resolutionWitness.calculateRoot(updateHash);

    this.resolutionsMerkleRoot.set(newResolutionRoot);

    this.emitEvent(
      'ProposalPassed',
      new CouncilProposalPassedEvent({
        resolutionTreeRootBefore: resolutionsMerkleRoot,
        updateHash,
        resolutionIndex: updateSpec.govResolutionIndex,
      })
    );
  }

  async supportProposalHelper(
    voteProof: ZkusdGoverningCouncilVoteProof,
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
    voteProof: ZkusdGoverningCouncilVoteProof,
    proposalWitness: MerkleMapWitness,
    proposalCurrentVoteBitArray: Field,
    resolutionWitness: ResolutionTree.Witness
  ) {
    voteProof.verify();

    const { proposalHash, councilMemberMerkleRoot, cummulatedVoteBitArray } =
      voteProof.publicOutput;

    // verify the root of the council member tree
    const councilMembersMerkleRoot =
      this.councilMembersMerkleRoot.getAndRequireEquals();
    councilMemberMerkleRoot.assertEquals(
      councilMembersMerkleRoot,
      'Invalid member witness'
    );

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

    const newVoteBitArray = ProposalMap.sumVotesProvably(proposalCurrentVoteBitArray, cummulatedVoteBitArray);
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
      new CouncilProposalSupportChangeEvent({
        proposalMapRootBefore: proposalMerkleRoot,
        acceptedVoteBitArray: newVoteBitArray,
        updateHash:proposalHash,
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
}
