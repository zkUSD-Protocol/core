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
  ZKUSD_GOV_UPDATE_TREE_HEIGHT,
  ZkusdGovUpdateWitness,
} from '../system/governance.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import {
  MAX_ZKUSD_COUNCIL_SIZE,
  ZKUSD_COUNCIL_TREE_HEIGHT,
  ZkusdCouncilMemberWitness,
  ZkusdGoverningCouncilVoteProof,
  pubkeyToCouncilSeatLeaf,
} from '../proofs/gov/council-multisig.js';

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

  init() {
    super.init();
  }

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

  async initializeWithKeys(
    councilKeys: PublicKey[],
    standardProposalPassThreshold: UInt8
  ) {
    const merkleTree =
      ZkusdGoverningCouncilContract.buildCouncilMerkleTree(councilKeys);
    const initialMembersRoot = merkleTree.getRoot();
    this.initialize(initialMembersRoot, standardProposalPassThreshold);
  }

  @method async initialize(
    initialMembersRoot: Field,
    standardProposalPassThreshold: UInt8
  ) {
    // this.adminPublicKey.set(adminPublicKey);
    // this.stopProtocolVkHash.set(stopProtocolVkHash);
    const proposalsMerkleMapRoot = new MerkleMap();
    const resolutionMerkleRoot = new MerkleTree(ZKUSD_GOV_UPDATE_TREE_HEIGHT);
    this.councilMembersMerkleRoot.set(initialMembersRoot);
    this.standardProposalPassThreshold.set(standardProposalPassThreshold);
    this.proposalsMerkleMapRoot.set(proposalsMerkleMapRoot.getRoot());
    this.resolutionsMerkleRoot.set(resolutionMerkleRoot.getRoot());
  }

  async deploy(args?: ZkUsdDeployArgs): Promise<void> {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.VerificationKey.signature(),

      editState: Permissions.proof(),
      send: Permissions.proof(),
    });
  }

  // async createProposal(
  //   proposalHash: Field,
  //   proposalWitness: MerkleMapWitness,
  //   memberWitness: ZkusdCouncilMemberWitness,
  //   memberSignature: Signature,
  //   memberPubkey: PublicKey,
  // ) {
  //   // ---- Verify that the given proposal path is not used yet
  //   const proposalMerkleRoot = this.proposalsMerkleMapRoot.getAndRequireEquals();

  //   // the value should be zero
  //   const currentValue = Field.from(0)
  //   const [rootBefore, computedKey] = proposalWitness.computeRootAndKey(
  //     currentValue,
  //   );

  //   // the root and key should match
  //   rootBefore.assertEquals(
  //     proposalMerkleRoot,
  //     'Invalid proposal witness'
  //   );
  //   // the computed key should match the proposal key
  //   computedKey.assertEquals(
  //     proposalHash,
  //     'Invalid proposal witness'
  //   );

  //   // ----

  //   // ---- Verify member witness, index and compute its field value
  //   const councilMembersMerkleRoot = this.councilMembersMerkleRoot.getAndRequireEquals();
  //   memberWitness.calculateRoot(
  //     Poseidon.hash(memberPubkey.toFields())
  //   ).assertEquals(
  //     councilMembersMerkleRoot,
  //     'Invalid member witness'
  //   );
  //   // the public key is now verified to be in the council tree

  //   const memberSeatIndex = memberWitness.calculateIndex();

  //   // make sure that the index is below the max council size
  //   memberSeatIndex.assertLessThan(
  //     Field.from(MAX_ZKUSD_COUNCIL_SIZE),
  //     'Council member index out of bounds'
  //   );

  //   // Compute the proposalVoteBitArray (1 vote) value
  //   // TODO find more optimized way to set the bit in the bit array:
  //   let index = Field.from(0);
  //   const bits = Field.from(0).toBits();
  //   for (let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++) {
  //     bits[i] = Provable.if(
  //       index.equals(memberSeatIndex),
  //       Bool(true),
  //       Bool(false)
  //     )
  //     index = index.add(1);
  //   }
  //   const proposalVoteBitArray = Field.fromBits(bits);

  //   // ---- Verify the member signature
  //   memberSignature.verify(
  //     memberPubkey,
  //     [proposalHash]
  //   ).assertTrue()
  //   // now we know that a council member has signed the proposal
  //   // as it is given in the input of the method

  //   // ---- Update the value for the proposal key with the vote

  //   const [newProposalsRoot] = proposalWitness.computeRootAndKey(
  //     proposalVoteBitArray,
  //   );

  //   // set the root and thus enable voting on the proposal
  //   this.proposalsMerkleMapRoot.set(newProposalsRoot);

  //   // TODO emit new event
  // }

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

    // TODO emit new event
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
  //     // the method is allowed:
  //     // some methods may have different verification requirements.
  //     const methodAllowed = zkEngineMethodCode
  //       .equals(ZkUsdEngineMethodCodes.GovStopProtocol)
  //       .or(
  //         zkEngineMethodCode.equals(
  //           ZkUsdEngineMethodCodes.GovUpdateCollateralRatio
  //         )
  //       );
  //     methodAllowed.assertTrue('Method not allowed');

  //     const updateSpecHash = Poseidon.hash(updateSpec.toFields());

  //     resolutionProof.verify(resolutionProgramVk);
  //     Provable.log('proof verified');

  //     Provable.log(
  //       'resolutionIndex',
  //       resolutionProof.publicInput.govResolutionIndex
  //     );

  //     // verify the proof's admin key against the on-chain state.
  //     const currentAdminHash = Poseidon.hash(
  //       this.adminPublicKey.getAndRequireEquals().toFields()
  //     );
  //     const proofAdminHash = resolutionProof.publicOutput.auxilliaryOutput[];

  //     Provable.log('admin keys hashes', currentAdminHash, proofAdminHash);

  //     currentAdminHash.assertEquals(
  //       proofAdminHash,
  //       'Admin public key does not match the proof'
  //     );
  //     Provable.log('return true');

  //     return Bool(true);
  //   }

  //   public async signAndCreateProtocolUpdate(
  //     input: ZkusdProtocolUpdateSpec,
  //     adminPrivateKey: PrivateKey
  //   ): Promise<ZkusdProtocolUpdateGovContractProof> {
  //     const signature = Signature.create(
  //       adminPrivateKey,
  //       input.toFields(),
  //     );
  //     return this.createProtocolUpdate(input, signature);
  //   }

  //   public async createProtocolUpdate(
  //     input: ZkusdProtocolUpdateSpec,
  //     signature: Signature
  //   ): Promise<ZkusdProtocolUpdateGovContractProof> {
  //     const adminPublicKey = this.adminPublicKey.getAndRequireEquals();
  //     const proof = await AdminSignatureZkusdProtocolUpdateProgram.create(
  //       input,
  //       signature,
  //       adminPublicKey,
  //     );
  //     return proof.proof;
  //   }
  // }

  // export class ZkUsdCouncilMultiSigContract extends ZkUsdGovernmentPoc {
  // }
}

export function countBits(x: Field): UInt8 {
  const bits = x.toBits();
  let voteCount = Field.from(0);
  for (let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++) {
    voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
  }
  const ret = UInt8.Unsafe.fromField(voteCount)
  return ret;
}
