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
import { EngineUpdateSpec } from '../../system/engine-update/input.js';
import { EngineUpdateOutput } from '../../system/engine-update/output.js';
import { Seat } from '../../system/council/seat.js';
import {
  CouncilMap,
  CouncilMapProvable,
} from '../../system/council/data/council-map.js';

/** Generic multisig zkusd protocol update program */
export const EngineUpdate = ZkProgram({
  name: 'EngineUpdate',
  publicInput: EngineUpdateSpec,
  publicOutput: EngineUpdateOutput,
  methods: {
    mergeVotes: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        publicInput: EngineUpdateSpec,
        leftProof: SelfProof<EngineUpdateSpec, EngineUpdateOutput>,
        rightProof: SelfProof<EngineUpdateSpec, EngineUpdateOutput>
      ): Promise<{ publicOutput: EngineUpdateOutput }> {
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
        leftOutput.councilMerkleMapRoot.assertEquals(
          rightOutput.councilMerkleMapRoot,
          'Council member trees do not match'
        );

        // now use the right output as this proof output
        // and set the vote bit array to the logical sum of the two
        rightOutput.cummulatedVoteBitArray = Gadgets.or(
          rightOutput.cummulatedVoteBitArray,
          leftOutput.cummulatedVoteBitArray,
          CouncilMap.SEAT_LIMIT
        );

        return { publicOutput: rightOutput };
      },
    },
    createVote: {
      privateInputs: [Signature, PublicKey, CouncilMapProvable, Seat],
      async method(
        publicInput: EngineUpdateSpec,
        voterSignature: Signature,
        voterPublicKey: PublicKey,
        councilMerkleMap: CouncilMapProvable,
        seat: Seat
      ): Promise<{ publicOutput: EngineUpdateOutput }> {
        seat.assertValid();
        const x = seat.value;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, CouncilMap.SEAT_LIMIT);
        andValue.assertEquals(Field(0));

        // verify the vote (signature)
        const proofDataFields = publicInput.toFields();
        voterSignature.verify(voterPublicKey, proofDataFields).assertTrue();

        // probably not needed, just as an extra check
        voterPublicKey.isEmpty().assertFalse('Empty public key not allowed.');

        // verify the public key is in the council map
        // include the index field value.
        // this assumes that it was provided in the merkle tree and is valid
        // if yes, then we can skip the index value computation as you cannot cheat it.
        const councilMember = councilMerkleMap.get(seat.value);

        Provable.log('councilMember', councilMember);

        councilMember.assertEquals(
          Poseidon.hash(voterPublicKey.toFields()),
          'Council member not correct'
        );

        return {
          publicOutput: new EngineUpdateOutput({
            proposalHash: Poseidon.hash(proofDataFields),
            councilMerkleMapRoot: councilMerkleMap.root,
            cummulatedVoteBitArray: seat.value,
          }),
        };
      },
    },
  },
});

export class EngineUpdateVoteProof extends ZkProgram.Proof(EngineUpdate) {}
