// --------------- Council

import {
  Field,
  Gadgets,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import { CouncilMap } from '../../system/council/data/council-map.js';
import {
  CouncilUpdateActions,
  CouncilUpdateVoteInput,
} from '../../system/council/update/input.js';
import { CouncilUpdateVoteOutput } from '../../system/council/update/output.js';

function pubkeyToCouncilSeatLeaf(councilKey: PublicKey, index: number): Field {
  const indexFieldValue = Field.from(2n ** BigInt(index));
  return pubkeyToCouncilSeatLeafFromFieldValue(councilKey, indexFieldValue);
}

function pubkeyToCouncilSeatLeafFromFieldValue(
  councilKey: PublicKey,
  indexFieldValue: Field
): Field {
  return Poseidon.hash([indexFieldValue, ...councilKey.toFields()]);
}

const ManageCouncil = ZkProgram({
  name: 'ManageCouncil',
  publicInput: CouncilUpdateVoteInput,
  publicOutput: CouncilUpdateVoteOutput,
  methods: {
    createVote: {
      privateInputs: [Signature, PublicKey, Field],
      async method(
        publicInput: CouncilUpdateVoteInput,
        voterSignature: Signature,
        voterPublicKey: PublicKey,
        councilMemberSeatPosition: Field // for the seat with an index of 3, this should be 2^3 = 8
      ): Promise<{ publicOutput: CouncilUpdateVoteOutput }> {
        const councilMap = publicInput.currentCouncilMap.clone();

        councilMemberSeatPosition.assertLessThan(
          Field.from(CouncilMap.SEAT_LIMIT)
        );
        const x = councilMemberSeatPosition;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, CouncilMap.SEAT_LIMIT);
        andValue.assertEquals(Field(0));

        voterSignature
          .verify(voterPublicKey, publicInput.councilManagementSpec.toFields())
          .assertTrue();

        voterPublicKey.isEmpty().assertFalse('Empty public key not allowed.');

        const councilMember = publicInput.currentCouncilMap.get(
          councilMemberSeatPosition
        );

        councilMember.assertEquals(
          Poseidon.hash(voterPublicKey.toFields()),
          'Council member not correct'
        );

        const maxActionLength = CouncilUpdateActions.MaxLength;
        const actions =
          publicInput.councilManagementSpec.councilManagementActions.actions;

        for (let i = 0; i < maxActionLength; i++) {
          const shouldAdd = actions[i].shouldAdd;
          const seatPosition = actions[i].councilSeatPosition;
          const councilKey = actions[i].councilKey;
          const isDummy = actions[i].isDummy;

          const updatedSeatValue = Provable.if(
            shouldAdd,
            Poseidon.hash(councilKey.toFields()),
            Field.from(0)
          );

          councilMap.setIf(isDummy.not(), seatPosition, updatedSeatValue);
        }

        return {
          publicOutput: {
            updatedCouncilMap: councilMap,
            cummulatedVoteBitArray: councilMemberSeatPosition,
          },
        };
      },
    },
    mergeVotes: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        publicInput: CouncilUpdateVoteInput,
        leftProof: SelfProof<
          CouncilUpdateVoteInput,
          CouncilUpdateVoteOutput
        >,
        rightProof: SelfProof<
          CouncilUpdateVoteInput,
          CouncilUpdateVoteOutput
        >
      ): Promise<{ publicOutput: CouncilUpdateVoteOutput }> {
        leftProof.verify();
        rightProof.verify();

        const currentInputHash = Poseidon.hash(
          publicInput.councilManagementSpec.toFields()
        );
        // assert public inputs matches the earlier proof
        currentInputHash.assertEquals(
          Poseidon.hash(leftProof.publicInput.councilManagementSpec.toFields()),
          'Public inputs do not match the left proof'
        );

        // assert public inputs matches the earlier proof
        currentInputHash.assertEquals(
          Poseidon.hash(
            rightProof.publicInput.councilManagementSpec.toFields()
          ),
          'Public inputs do not match the left proof'
        );

        const leftOutput = leftProof.publicOutput;
        let rightOutput = rightProof.publicOutput;

        // output hash is set in a verifiable way, no need to check.
        // but the merkle root has to be checked
        leftOutput.updatedCouncilMap.root.assertEquals(
          rightOutput.updatedCouncilMap.root,
          'Council member trees do not match'
        );

        rightOutput.cummulatedVoteBitArray = Gadgets.or(
          rightOutput.cummulatedVoteBitArray,
          leftOutput.cummulatedVoteBitArray,
          CouncilMap.SEAT_LIMIT
        );

        return { publicOutput: rightOutput };
      },
    },
  },
});

class CouncilUpdateVoteProof extends ZkProgram.Proof(ManageCouncil) {}

export {
  CouncilUpdateVoteProof,
  ManageCouncil,
  pubkeyToCouncilSeatLeaf,
  pubkeyToCouncilSeatLeafFromFieldValue,
};
