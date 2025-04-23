import {
  Field,
  Gadgets,
  Poseidon,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import { ZkusdProtocolUpdateSpec } from '../../system/update/input.js';
import { ZkusdProtocolUpdateOutput } from '../../system/update/output.js';
import { CouncilTree } from '../../system/council/council-tree.js';

// --------------- Council

export const MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE: bigint =
  1n << BigInt(CouncilTree.MAX_SIZE);

/** Generic multisig zkusd protocol update program */
export const MultiSigZkusdProtocolUpdateProgram = ZkProgram({
  name: 'MultiSigZkusdProtocolUpdateProgram',
  publicInput: ZkusdProtocolUpdateSpec,
  publicOutput: ZkusdProtocolUpdateOutput,
  methods: {
    mergeVotes: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        publicInput: ZkusdProtocolUpdateSpec,
        leftProof: SelfProof<
          ZkusdProtocolUpdateSpec,
          ZkusdProtocolUpdateOutput
        >,
        rightProof: SelfProof<
          ZkusdProtocolUpdateSpec,
          ZkusdProtocolUpdateOutput
        >
      ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
        leftProof.verify();
        rightProof.verify();

        const currentInputHash = Poseidon.hash(publicInput.toFields());
        // assert public inputs matches the earlier proof
        currentInputHash.assertEquals(
          Poseidon.hash(leftProof.publicInput.toFields()),
          'Public inputs do not match the left proof'
        );

        // assert public inputs matches the earlier proof
        currentInputHash.assertEquals(
          Poseidon.hash(rightProof.publicInput.toFields()),
          'Public inputs do not match the left proof'
        );
        // output checks
        const leftOutput = leftProof.publicOutput;
        let rightOutput = rightProof.publicOutput;

        // output hash is set in a verifiable way, no need to check.
        // but the merkle root has to be checked
        leftOutput.councilMemberMerkleRoot.assertEquals(
          rightOutput.councilMemberMerkleRoot,
          'Council member trees do not match'
        );

        // now use the right output as this proof output
        // and set the vote bit array to the logical sum of the two
        rightOutput.cummulatedVoteBitArray = Gadgets.or(
          rightOutput.cummulatedVoteBitArray,
          leftOutput.cummulatedVoteBitArray,
          CouncilTree.MAX_SIZE
        );

        return { publicOutput: rightOutput };
      },
    },
    createVote: {
      privateInputs: [
        Signature,
        PublicKey,
        CouncilTree.Witness,
        Field,
        Field,
      ],
      async method(
        publicInput: ZkusdProtocolUpdateSpec,
        updateSignature: Signature,
        signaturePublicKey: PublicKey,
        councilMemberWitness: CouncilTree.Witness,
        councilMemberMerkleRoot: Field,
        councilMemberTreeIndexFieldValue: Field // for the seat with an index of 3, this should be 2^3 = 8
      ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
        councilMemberTreeIndexFieldValue.assertLessThan(
          Field.from(MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE)
        );
        const x = councilMemberTreeIndexFieldValue;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, CouncilTree.MAX_SIZE);
        andValue.assertEquals(Field(0));

        // verify the vote (signature)
        const proofDataFields = publicInput.toFields();
        updateSignature
          .verify(signaturePublicKey, proofDataFields)
          .assertTrue();

        // probably not needed, just as an extra check
        signaturePublicKey
          .isEmpty()
          .assertFalse('Empty public key not allowed.');

        // verify the public key is in the council tree
        // include the index field value.
        // this assumes that it was provided in the merkle tree and is valid
        // if yes, then we can skip the index value computation as you cannot cheat it.
        const computedRoot = councilMemberWitness.calculateRoot(
          pubkeyToCouncilSeatLeaf_(
            signaturePublicKey,
            councilMemberTreeIndexFieldValue
          )
        );

        councilMemberMerkleRoot.assertEquals(
          computedRoot,
          'Tree witness with provided vk not correct'
        );

        return {
          publicOutput: {
            proposalHash: Poseidon.hash(proofDataFields),
            councilMemberMerkleRoot,
            cummulatedVoteBitArray: councilMemberTreeIndexFieldValue,
          },
        };
      },
    },
  },
});

// TODO use the algorithm from the tree to compute the leaf
export function pubkeyToCouncilSeatLeaf(
  councilKey: PublicKey,
  index: number
): Field {
  const indexFieldValue = Field.from(2n ** BigInt(index));
  return pubkeyToCouncilSeatLeaf_(councilKey, indexFieldValue);
}

function pubkeyToCouncilSeatLeaf_(
  councilKey: PublicKey,
  indexFieldValue: Field
): Field {
  return Poseidon.hash([indexFieldValue, ...councilKey.toFields()]);
}

export class ZkusdGoverningCouncilVoteProof extends ZkProgram.Proof(
  MultiSigZkusdProtocolUpdateProgram
) {}
