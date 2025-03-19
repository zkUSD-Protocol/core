import {
  AccountUpdate,
  Bool,
  Field,
  Gadgets,
  MerkleWitness,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  SmartContract,
  State,
  UInt8,
  VerificationKey,
  ZkProgram,
  method,
  state,
} from 'o1js';
import {
  NotAFinalZkusdProtocolUpdateProof,
  YesItIsAFinalZkusdProtocolUpdateProof,
  ZkusdProtocolUpdateGovContractProof,
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput,
  ZkusdProtocolUpdateProof,
  zkusdProtocolUpdateInputToFields,
} from '../system/update.js';

import { ZkusdGovResolutionProgramWitness } from '../system/governance.js';

export class ZkUsdGovernmentPoc extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.
  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    _resolutionProgramVk: VerificationKey,
    _resolutionProgramVkhWitness: ZkusdGovResolutionProgramWitness,
    _resolutionProof: ZkusdProtocolUpdateProof,
  ) {
    return Bool(false);
  }
}


export class ZkAdminSignatureContract extends ZkUsdGovernmentPoc {
  @state(PublicKey) adminPublicKey = State<PublicKey>();
  @state(Field) stopProtocolVkHash = State<Field>();

  async ensureAdminSignature(): Promise<AccountUpdate> {
    const admin = this.adminPublicKey.getAndRequireEquals();
    return AccountUpdate.createSigned(admin);
  }

  @method
  async changeAdmin(newAdmin: PublicKey) {
    await this.ensureAdminSignature();
    this.adminPublicKey.set(newAdmin);
  }

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionProgramVk: VerificationKey,
    resolutionProgramVkhWitness: ZkusdGovResolutionProgramWitness,
    resolutionProof: ZkusdProtocolUpdateProof,
  ) {
    const vkh = this.stopProtocolVkHash.getAndRequireEquals();
    const ret = vkh.equals(resolutionProgramVk.hash);

    const currentAdminHash = Poseidon.hash(
      this.adminPublicKey.getAndRequireEquals().toFields()
    );
    const proofAdminHash =
      resolutionProof.publicOutput.auxilliaryOutput[0];

    currentAdminHash.assertEquals(
      proofAdminHash,
      'Admin public key does not match the proof'
    );

    return ret;
  }

  @method.returns(ZkusdProtocolUpdateGovContractProof)
  public async signAndCreateProtocolUpdate(
    input: ZkusdProtocolUpdateInput,
    adminPrivateKey: PrivateKey,
  ): Promise<ZkusdProtocolUpdateGovContractProof> {
    const signature = Signature.create(
      adminPrivateKey,
      zkusdProtocolUpdateInputToFields(input)
    );
    return this.createProtocolUpdate(input, signature);
  }

  @method.returns(ZkusdProtocolUpdateGovContractProof)
  public async createProtocolUpdate(
    input: ZkusdProtocolUpdateInput,
    signature: Signature,
  ): Promise<ZkusdProtocolUpdateGovContractProof> {
    const adminPublicKey = this.adminPublicKey.getAndRequireEquals();
    const proof = await AdminSignatureZkusdProtocolUpdateProgram.create(
      input,
      signature,
      adminPublicKey
    );
    return proof.proof;
  }
}

export async function signAndCreateProtocolUpdateOffChain(args: {
  input: ZkusdProtocolUpdateInput;
  adminPrivateKey: PrivateKey;
}) {
  const signature = Signature.create(
    args.adminPrivateKey,
    zkusdProtocolUpdateInputToFields(args.input)
  );

  return await createProtocolUpdateOffChain({
    input: args.input,
    signature,
    adminPublicKey: args.adminPrivateKey.toPublicKey(),
  });
}

export async function createProtocolUpdateOffChain(args: {
  input: ZkusdProtocolUpdateInput;
  signature: Signature;
  adminPublicKey: PublicKey;
}) {
  const proof = await AdminSignatureZkusdProtocolUpdateProgram.create(
    args.input,
    args.signature,
    args.adminPublicKey
  );
  return proof;
}

/** Generic admin signature zkusd protocol update program */
export const AdminSignatureZkusdProtocolUpdateProgram = ZkProgram({
  name: 'AdminSignatureZkusdProtocolUpdateProgram',
  publicInput: ZkusdProtocolUpdateInput,
  publicOutput: ZkusdProtocolUpdateOutput,
  methods: {
    create: {
      privateInputs: [Signature, PublicKey],
      async method(
        publicInput: ZkusdProtocolUpdateInput,
        updateSignature: Signature,
        signaturePublicKey: PublicKey
      ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
        const proofDataFields = zkusdProtocolUpdateInputToFields(publicInput);
        updateSignature.verify(signaturePublicKey, proofDataFields);

        return {
          publicOutput: {
            protocolUpdateHash: Poseidon.hash(proofDataFields),
            auxilliaryOutput: [
              Poseidon.hash(signaturePublicKey.toFields()),
              Field.from(0),
              Field.from(0),
              Field.from(0),
            ],
            isFinalProof: YesItIsAFinalZkusdProtocolUpdateProof
          },
        };
      },
    },
  },
});


// --------------- Council

export const MAX_ZKUSD_COUNCIL_SIZE = 240 // so that we get bitwise operations which cap at 240 bits per field (more (up to 254) may result in potential underconstraint issues in the circuit)
export const ZKUSD_COUNCIL_TREE_HEIGHT = 8; // will fit the 240 council members

export class ZkusdCouncilMemberWitness extends MerkleWitness(ZKUSD_COUNCIL_TREE_HEIGHT) {}

function sumBits(bitField: Field){
  let sum = Field.from(0);
  const bits = bitField.toBits();
  for(let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++){
    sum = Provable.if(bits[i], sum.add(Field.from(1)), sum);
  }
  return UInt8.Unsafe.fromField(sum)
}

/** Generic multisig zkusd protocol update program */
export function MultiSigZkusdProtocolUpdateProgram(
  minVotes: UInt8
) {
  return ZkProgram({
    name: 'MultiSigZkusdProtocolUpdateProgram',
    publicInput: ZkusdProtocolUpdateInput,
    publicOutput: ZkusdProtocolUpdateOutput,
    methods: {
      verifyMinVotes: {
        privateInputs: [SelfProof],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          earlierProof: SelfProof<ZkusdProtocolUpdateInput, ZkusdProtocolUpdateOutput>,
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {

          earlierProof.verify();

          // assert public inputs matches the earlier proof
          Poseidon.hash(zkusdProtocolUpdateInputToFields(publicInput)).assertEquals(
            Poseidon.hash(zkusdProtocolUpdateInputToFields(earlierProof.publicInput)),
            'Public inputs do not match the earlier proof'
          );

          // compute votes
          const votes = sumBits(earlierProof.publicOutput.auxilliaryOutput[0]);
          votes.assertGreaterThanOrEqual(minVotes, 'Not enough votes');

          const output = earlierProof.publicOutput;
          output.isFinalProof = YesItIsAFinalZkusdProtocolUpdateProof

          return { publicOutput: output };
        }
      },
      mergeVotes: {
        privateInputs: [SelfProof, SelfProof],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          leftProof: SelfProof<ZkusdProtocolUpdateInput, ZkusdProtocolUpdateOutput>,
          rightProof: SelfProof<ZkusdProtocolUpdateInput, ZkusdProtocolUpdateOutput>,
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {

          leftProof.verify();
          rightProof.verify()

          // assert public inputs matches the earlier proof
          Poseidon.hash(zkusdProtocolUpdateInputToFields(publicInput)).assertEquals(
            Poseidon.hash(zkusdProtocolUpdateInputToFields(leftProof.publicInput)),
            'Public inputs do not match the left proof'
          );

          // assert public inputs matches the earlier proof
          Poseidon.hash(zkusdProtocolUpdateInputToFields(publicInput)).assertEquals(
            Poseidon.hash(zkusdProtocolUpdateInputToFields(rightProof.publicInput)),
            'Public inputs do not match the left proof'
          );
          // output hash is set in a verifiable way, no need to check.

          const leftOutput = leftProof.publicOutput;
          let rightOutput = rightProof.publicOutput;

          rightOutput.auxilliaryOutput[0] = Gadgets.or(rightOutput.auxilliaryOutput[0], leftOutput.auxilliaryOutput[0], MAX_ZKUSD_COUNCIL_SIZE);

          const output = new ZkusdProtocolUpdateOutput({
            protocolUpdateHash: leftOutput.protocolUpdateHash,
            auxilliaryOutput: rightOutput.auxilliaryOutput,
            isFinalProof: NotAFinalZkusdProtocolUpdateProof,
          })

          output.isFinalProof = NotAFinalZkusdProtocolUpdateProof;

          return { publicOutput: output };
        }
      },
      createVote: {
        privateInputs: [Signature, PublicKey, ZkusdCouncilMemberWitness, Field, Field, Field],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          updateSignature: Signature,
          signaturePublicKey: PublicKey,
          councilMemberWitness: ZkusdCouncilMemberWitness,
          councilMemberTreeRoot: Field,
          councilMemberTreeIndex: Field,
          councilMemberHidingSecret: Field,
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
          // the index must be less than the max council size
          councilMemberTreeIndex.assertLessThan(
            Field.from(MAX_ZKUSD_COUNCIL_SIZE),
            'Council member index out of bounds'
          );
          // verify the vote (signature)
          const proofDataFields = zkusdProtocolUpdateInputToFields(publicInput);
          updateSignature.verify(signaturePublicKey, proofDataFields);
          // ---

          // verify the public key is in the council tree
          const computedRoot = councilMemberWitness.calculateRoot(Poseidon.hash([councilMemberTreeIndex, ...signaturePublicKey.toFields(), councilMemberHidingSecret]));
          councilMemberTreeRoot.assertEquals(
            computedRoot,
            'Tree witness with provided vk not correct'
          );
          // ---

          // produce the output
          const auxilliaryOutput = [
            councilMemberTreeIndex, // the index of the council member who voted, works as a vote counter as well (number of bits set)
            Field.from(0),
            Field.from(0), // free slot
            Field.from(0), // free slot
          ];

          return {
            publicOutput: {
              protocolUpdateHash: Poseidon.hash(proofDataFields),
              auxilliaryOutput,
              isFinalProof: NotAFinalZkusdProtocolUpdateProof,
            },
          };
        },
      },
    },
  })
};
