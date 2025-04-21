import {
  Field,
  Gadgets,
  MerkleWitness,
  Poseidon,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import { ZkusdProtocolUpdateSpec } from '../../system/update/input.js';
import { ZkusdProtocolUpdateOutput } from '../../system/update/output.js';

// --------------- Council

export const MAX_ZKUSD_COUNCIL_SIZE = 240; // so that we get bitwise operations which cap at 240 bits per field (more (up to 254) may result in potential underconstraint issues in the circuit)
export const MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE: bigint = 2n ** BigInt(MAX_ZKUSD_COUNCIL_SIZE);
export const ZKUSD_COUNCIL_TREE_HEIGHT = 9; // will fit the 240 council members

export class ZkusdCouncilMemberWitness extends MerkleWitness(
  ZKUSD_COUNCIL_TREE_HEIGHT
) {}


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
          MAX_ZKUSD_COUNCIL_SIZE
        );

        return { publicOutput: rightOutput };
      },
    },
    createVote: {
      privateInputs: [
        Signature,
        PublicKey,
        ZkusdCouncilMemberWitness,
        Field,
        Field,
      ],
      async method(
        publicInput: ZkusdProtocolUpdateSpec,
        updateSignature: Signature,
        signaturePublicKey: PublicKey,
        councilMemberWitness: ZkusdCouncilMemberWitness,
        councilMemberMerkleRoot: Field,
        councilMemberTreeIndexFieldValue: Field, // for the seat with an index of 3, this should be 2^3 = 8
      ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {

        councilMemberTreeIndexFieldValue.assertLessThan(
          Field.from(MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE));
        const x = councilMemberTreeIndexFieldValue;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, MAX_ZKUSD_COUNCIL_SIZE);
        andValue.assertEquals(Field(0));

        // verify the vote (signature)
        const proofDataFields = publicInput.toFields();
        updateSignature.verify(signaturePublicKey, proofDataFields).assertTrue();

        // probably not needed, just as an extra check
        signaturePublicKey.isEmpty().assertFalse('Empty public key not allowed.');

        // verify the public key is in the council tree
        // include the index field value.
        // this assumes that it was provided in the merkle tree and is valid
        // if yes, then we can skip the index value computation as you cannot cheat it.
        const computedRoot = councilMemberWitness.calculateRoot(
          pubkeyToCouncilSeatLeaf_(signaturePublicKey, councilMemberTreeIndexFieldValue));

        councilMemberMerkleRoot.assertEquals(
          computedRoot,
          'Tree witness with provided vk not correct'
        );

        return {
          publicOutput: {
            proposalHash: Poseidon.hash(proofDataFields),
            councilMemberMerkleRoot,
            cummulatedVoteBitArray: councilMemberTreeIndexFieldValue
          },
        };
      },
    },
  },
});

export function pubkeyToCouncilSeatLeaf(
  councilKey: PublicKey,
  index: number,
): Field {
  const indexFieldValue = Field.from(2n ** BigInt(index));
  return pubkeyToCouncilSeatLeaf_(
    councilKey,
    indexFieldValue
  );
}

function pubkeyToCouncilSeatLeaf_(
  councilKey: PublicKey,
  indexFieldValue: Field,
): Field {
  return Poseidon.hash([indexFieldValue, ...councilKey.toFields()]);
}


function assertOneBitSet(x: Field) {
  // we want to check: x != 0, and (x & (x - 1)) == 0
  x.assertGreaterThan(Field(0));
  let xMinus1 = x.sub(Field(1));

  let andValue = Gadgets.and(x, xMinus1, MAX_ZKUSD_COUNCIL_SIZE);
  andValue.assertEquals(Field(0));
}


export class ZkusdGoverningCouncilVoteProof extends ZkProgram.Proof(MultiSigZkusdProtocolUpdateProgram)
{
}
