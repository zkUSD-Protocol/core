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
import { CouncilUpdateVoteInput } from '../../system/council/update/input.js';
import { CouncilUpdateActions } from '../../system/council/update/common.js';
import { CouncilUpdateVoteOutput } from '../../system/council/update/output.js';
import { Seat } from '../../system/council/seat.js';

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

const CouncilUpdate = ZkProgram({
  name: 'CouncilUpdate',
  publicInput: CouncilUpdateVoteInput,
  publicOutput: CouncilUpdateVoteOutput,
  methods: {
    createVote: {
      privateInputs: [Signature, PublicKey, Seat],
      async method(
        publicInput: CouncilUpdateVoteInput,
        voterSignature: Signature,
        voterPublicKey: PublicKey,
        seat: Seat
      ): Promise<{ publicOutput: CouncilUpdateVoteOutput }> {
        const councilMap = publicInput.currentCouncilMap.clone();

        seat.assertValid();
        voterSignature
          .verify(voterPublicKey, publicInput.councilManagementSpec.toFields())
          .assertTrue();

        voterPublicKey.isEmpty().assertFalse('Empty public key not allowed.');

        const councilMember = publicInput.currentCouncilMap.get(seat.value);

        councilMember.assertEquals(
          Poseidon.hash(voterPublicKey.toFields()),
          'Council member not correct'
        );

        const maxActionLength = CouncilUpdateActions.MaxLength;
        const actions =
          publicInput.councilManagementSpec.councilManagementActions.actions;

        for (let i = 0; i < maxActionLength; i++) {
          const shouldAdd = actions[i].shouldAdd;
          const seat = actions[i].seat;
          const councilKey = actions[i].member;
          const isDummy = actions[i].isDummy;

          seat.assertValid();

          const updatedSeatValue = Provable.if(
            shouldAdd,
            Poseidon.hash(councilKey.toFields()),
            Field.from(0)
          );

          councilMap.setIf(isDummy.not(), seat.value, updatedSeatValue);
        }

        return {
          publicOutput: {
            updatedCouncilMap: councilMap,
            cummulatedVoteBitArray: seat.value,
          },
        };
      },
    },
    mergeVotes: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        publicInput: CouncilUpdateVoteInput,
        leftProof: SelfProof<CouncilUpdateVoteInput, CouncilUpdateVoteOutput>,
        rightProof: SelfProof<CouncilUpdateVoteInput, CouncilUpdateVoteOutput>
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

class CouncilUpdateVoteProof extends ZkProgram.Proof(CouncilUpdate) {}

export {
  CouncilUpdateVoteProof,
  CouncilUpdate,
  pubkeyToCouncilSeatLeaf,
  pubkeyToCouncilSeatLeafFromFieldValue,
};
