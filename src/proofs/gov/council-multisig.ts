import {
  Field,
  Gadgets,
  MerkleWitness,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  UInt8,
  ZkProgram,
} from 'o1js';
import { ZkusdProtocolUpdateInput } from '../../system/update/input';
import { NotAFinalZkusdProtocolUpdateProof, YesItIsAFinalZkusdProtocolUpdateProof, ZkusdProtocolUpdateOutput } from '../../system/update/output';

// --------------- Council

export const MAX_ZKUSD_COUNCIL_SIZE = 240; // so that we get bitwise operations which cap at 240 bits per field (more (up to 254) may result in potential underconstraint issues in the circuit)
export const ZKUSD_COUNCIL_TREE_HEIGHT = 8; // will fit the 240 council members

export class ZkusdCouncilMemberWitness extends MerkleWitness(
  ZKUSD_COUNCIL_TREE_HEIGHT
) {}

function sumBits(bitField: Field) {
  let sum = Field.from(0);
  const bits = bitField.toBits();
  for (let i = 0; i < MAX_ZKUSD_COUNCIL_SIZE; i++) {
    sum = Provable.if(bits[i], sum.add(Field.from(1)), sum);
  }
  return UInt8.Unsafe.fromField(sum);
}

/** Generic multisig zkusd protocol update program */
export function MultiSigZkusdProtocolUpdateProgram(minVotes: UInt8) {
  return ZkProgram({
    name: 'MultiSigZkusdProtocolUpdateProgram',
    publicInput: ZkusdProtocolUpdateInput,
    publicOutput: ZkusdProtocolUpdateOutput,
    methods: {
      verifyMinVotes: {
        privateInputs: [SelfProof],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          earlierProof: SelfProof<
            ZkusdProtocolUpdateInput,
            ZkusdProtocolUpdateOutput
          >
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
          earlierProof.verify();

          // assert public inputs matches the earlier proof
          Poseidon.hash(
            publicInput.toFields()
          ).assertEquals(
            Poseidon.hash(
              earlierProof.publicInput.toFields()
            ),
            'Public inputs do not match the earlier proof'
          );

          // compute votes
          const votes = sumBits(earlierProof.publicOutput.auxilliaryOutput[0]);
          votes.assertGreaterThanOrEqual(minVotes, 'Not enough votes');

          const output = earlierProof.publicOutput;
          output.isFinalProof = YesItIsAFinalZkusdProtocolUpdateProof;

          return { publicOutput: output };
        },
      },
      mergeVotes: {
        privateInputs: [SelfProof, SelfProof],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          leftProof: SelfProof<
            ZkusdProtocolUpdateInput,
            ZkusdProtocolUpdateOutput
          >,
          rightProof: SelfProof<
            ZkusdProtocolUpdateInput,
            ZkusdProtocolUpdateOutput
          >
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
          leftProof.verify();
          rightProof.verify();

          const currentInputHash = Poseidon.hash(
            publicInput.toFields()
          );
          // assert public inputs matches the earlier proof
          currentInputHash.assertEquals(
            Poseidon.hash
            (
              leftProof.publicInput.toFields()
            ),
            'Public inputs do not match the left proof'
          );

          // assert public inputs matches the earlier proof
          currentInputHash.assertEquals(
            Poseidon.hash(
              rightProof.publicInput.toFields()
            ),
            'Public inputs do not match the left proof'
          );
          // output hash is set in a verifiable way, no need to check.

          const leftOutput = leftProof.publicOutput;
          let rightOutput = rightProof.publicOutput;

          rightOutput.auxilliaryOutput[0] = Gadgets.or(
            rightOutput.auxilliaryOutput[0],
            leftOutput.auxilliaryOutput[0],
            MAX_ZKUSD_COUNCIL_SIZE
          );

          const output = new ZkusdProtocolUpdateOutput({
            protocolUpdateHash: leftOutput.protocolUpdateHash,
            auxilliaryOutput: rightOutput.auxilliaryOutput,
            isFinalProof: NotAFinalZkusdProtocolUpdateProof,
          });

          output.isFinalProof = NotAFinalZkusdProtocolUpdateProof;

          return { publicOutput: output };
        },
      },
      createVote: {
        privateInputs: [
          Signature,
          PublicKey,
          ZkusdCouncilMemberWitness,
          Field,
          Field,
          Field,
        ],
        async method(
          publicInput: ZkusdProtocolUpdateInput,
          updateSignature: Signature,
          signaturePublicKey: PublicKey,
          councilMemberWitness: ZkusdCouncilMemberWitness,
          councilMemberTreeRoot: Field,
          councilMemberTreeIndex: Field,
          councilMemberHidingSecret: Field
        ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
          // the index must be less than the max council size
          councilMemberTreeIndex.assertLessThan(
            Field.from(MAX_ZKUSD_COUNCIL_SIZE),
            'Council member index out of bounds'
          );
          // verify the vote (signature)
          const proofDataFields = publicInput.toFields();
          updateSignature.verify(signaturePublicKey, proofDataFields);
          // ---

          // verify the public key is in the council tree
          const computedRoot = councilMemberWitness.calculateRoot(
            Poseidon.hash([
              councilMemberTreeIndex,
              ...signaturePublicKey.toFields(),
              councilMemberHidingSecret,
            ])
          );
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
  });
}
