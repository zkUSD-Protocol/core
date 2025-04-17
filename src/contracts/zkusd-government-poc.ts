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
  PublicKey,
  MerkleTree,
  MerkleMap,
} from 'o1js';

import {
  InitialCouncilMembers,
  ZKUSD_GOV_UPDATE_TREE_HEIGHT,
  ZkusdGovUpdateWitness,
} from '../system/governance.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import {
  MAX_ZKUSD_COUNCIL_SIZE,
  ZKUSD_COUNCIL_TREE_HEIGHT,
  ZkusdGoverningCouncilVoteProof,
  pubkeyToCouncilSeatLeaf,
} from '../proofs/gov/council-multisig.js';
import {
  CouncilProposalPassedEvent,
  CouncilProposalSupportChangeEvent,
  NewCouncilInitializedEvent,
  NewCouncilInitializedWithFixedKeysEvent,
} from '../system/council-events.js';
import { ensureMinArrayLength } from '../utils/array.js';

export class ZkUsdGovernmentPoc extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.

  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionUpdateSpec: ZkusdProtocolUpdateSpec,
    resolutionWitness: ZkusdGovUpdateWitness
  ) {
    Provable.log('base method called');
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

export class ZkusdGoverningCouncilContract extends ZkUsdGovernmentPoc {
  @state(Field) councilMembersMerkleRoot = State<Field>();
  @state(Field) proposalsMerkleMapRoot = State<Field>();
  @state(Field) resolutionsMerkleRoot = State<Field>();
  @state(UInt8) standardProposalPassThreshold = State<UInt8>();

  readonly events = {
    ProposalSupported: CouncilProposalSupportChangeEvent,
    ProposalPassed: CouncilProposalPassedEvent,
    NewCouncilInitialized: NewCouncilInitializedEvent,
    NewCouncilInitializedWithFixedKeys: NewCouncilInitializedWithFixedKeysEvent,
  };

  init() {
    super.init();
  }

  // build the council merkle tree in a way compatible with the
  // council seat leaf hashing function
  static buildCouncilMerkleTree(councilKeys: PublicKey[]) {
    const leaves = councilKeys.map((councilKey, index) => {
      return pubkeyToCouncilSeatLeaf(councilKey, index);
    });

    const merkleTree = new MerkleTree(ZKUSD_COUNCIL_TREE_HEIGHT);
    leaves.forEach((leaf, index) => {
      merkleTree.setLeaf(BigInt(index), leaf);
    });
    return merkleTree;
  }

  // build the council merkle tree in a way compatible with the
  // council seat leaf hashing function.
  // this will additionally check that the root of the tree
  // matches the one stored in the on-chain state
  buildAndVerifyCouncilMerkleTree(councilKeys: PublicKey[]) {
    const merkleTree =
      ZkusdGoverningCouncilContract.buildCouncilMerkleTree(councilKeys);
    const councilMembersMerkleRoot =
      this.councilMembersMerkleRoot.getAndRequireEquals();
    const currentCouncilMembersMerkleRoot = merkleTree.getRoot();
    currentCouncilMembersMerkleRoot.assertEquals(
      councilMembersMerkleRoot,
      'Invalid council members tree'
    );
    return merkleTree;
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
    const merkleTree = ZkusdGoverningCouncilContract.buildCouncilMerkleTree(
      councilMembers
    );

    const councilMerkleRoot = merkleTree.getRoot();
    await this.initializeWithCouncilMembersKeys(
      councilMerkleRoot,
      new InitialCouncilMembers({ councilMembers: councilMembersProvableArray }),
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
    const proposalsMerkleMapRoot = new MerkleMap();
    const resolutionMerkleRoot = new MerkleTree(ZKUSD_GOV_UPDATE_TREE_HEIGHT);
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
    resolutionWitness: ZkusdGovUpdateWitness
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

    // now check if the vote count is above the treshold
    const treshold = this.standardProposalPassThreshold.getAndRequireEquals();
    const bits = proposalCurrentVoteBitArray.toBits();
    let voteCount = Field.from(0);
    for (let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++) {
      voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
    }
    // voteCount should be equal to or above the treshold
    voteCount.assertGreaterThanOrEqual(
      treshold.value,
      'Vote count is below the treshold'
    );

    // recompute the root and set it and thus enable executing the resolution
    const newResolutionRoot = resolutionWitness.calculateRoot(proposalHash);

    this.resolutionsMerkleRoot.set(newResolutionRoot);

    this.emitEvent(
      'ProposalPassed',
      new CouncilProposalPassedEvent({
        proposalHash,
        resolutionIndex: updateSpec.govResolutionIndex,
      })
    );
  }

  async supportProposalHelper(
    voteProof: ZkusdGoverningCouncilVoteProof,
    proposalTree: MerkleMap,
    resolutionTree: MerkleTree
  ) {
    const proposalWitness = proposalTree.getWitness(
      voteProof.publicOutput.proposalHash
    );
    const resolutionWitness = new ZkusdGovUpdateWitness(
      resolutionTree.getWitness(
        voteProof.publicInput.govResolutionIndex.toBigint()
      )
    );
    const proposalCurrentVoteBitArray = proposalTree.get(
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
    resolutionWitness: ZkusdGovUpdateWitness
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

    const newVoteBitArray = Gadgets.or(
      proposalCurrentVoteBitArray,
      cummulatedVoteBitArray,
      MAX_ZKUSD_COUNCIL_SIZE
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
      new CouncilProposalSupportChangeEvent({
        proposalTreeRootBefore: proposalMerkleRoot,
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
    resolutionWitness: ZkusdGovUpdateWitness
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

export function countBits(x: Field): UInt8 {
  const bits = x.toBits();
  let voteCount = Field.from(0);
  for (let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++) {
    voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
  }
  const ret = UInt8.Unsafe.fromField(voteCount);
  return ret;
}
