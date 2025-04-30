// --------------- Council

import {
  Field,
  Gadgets,
  MerkleWitness,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import {
  ZkusdCouncilManagementActions,
  ZkusdCouncilManagementInput,
  ZkusdCouncilManagementSpec,
} from '../../system/council-management/input.js';
import { ZkusdCouncilManagementOutput } from '../../system/council-management/output.js';
import {
  MAX_ZKUSD_COUNCIL_SIZE,
  MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE,
  ZkusdCouncilWitness,
} from './common.js';

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
  publicInput: ZkusdCouncilManagementInput,
  publicOutput: ZkusdCouncilManagementOutput,
  methods: {
    createVote: {
      privateInputs: [Signature, PublicKey, Field],
      async method(
        publicInput: ZkusdCouncilManagementInput,
        voterSignature: Signature,
        voterPublicKey: PublicKey,
        councilMemberSeatPosition: Field // for the seat with an index of 3, this should be 2^3 = 8
      ): Promise<{ publicOutput: ZkusdCouncilManagementOutput }> {
        const councilMap = publicInput.currentCouncilMap;

        councilMemberSeatPosition.assertLessThan(
          Field.from(MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE)
        );
        const x = councilMemberSeatPosition;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, MAX_ZKUSD_COUNCIL_SIZE);
        andValue.assertEquals(Field(0));

        // verify the vote (signature)
        const managementSpecHash = publicInput.councilManagementSpec.hash();

        voterSignature
          .verify(voterPublicKey, managementSpecHash.toFields())
          .assertTrue();

        voterPublicKey.isEmpty().assertFalse('Empty public key not allowed.');

        const councilMember = publicInput.currentCouncilMap.get(
          councilMemberSeatPosition
        );

        councilMember.assertEquals(
          Poseidon.hash(voterPublicKey.toFields()),
          'Council member not correct'
        );

        const maxActionLength = ZkusdCouncilManagementActions.MaxLength;
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
        publicInput: ZkusdCouncilManagementInput,
        leftProof: SelfProof<
          ZkusdCouncilManagementInput,
          ZkusdCouncilManagementOutput
        >,
        rightProof: SelfProof<
          ZkusdCouncilManagementInput,
          ZkusdCouncilManagementOutput
        >
      ): Promise<{ publicOutput: ZkusdCouncilManagementOutput }> {
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
          MAX_ZKUSD_COUNCIL_SIZE
        );

        return { publicOutput: rightOutput };
      },
    },
  },
});

class ZkusdCouncilManagementVoteProof extends ZkProgram.Proof(ManageCouncil) {}

export {
  ZkusdCouncilManagementVoteProof,
  ManageCouncil,
  pubkeyToCouncilSeatLeaf,
  pubkeyToCouncilSeatLeafFromFieldValue,
};
