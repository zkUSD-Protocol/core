import { UInt8, Field, Poseidon, PrivateKey, Signature } from "o1js";
import { EngineUpdate, EngineUpdateVoteProof } from "../../../proofs/engine-update/prove.js";
import { CouncilUpdate, CouncilUpdateVoteProof } from "../../../proofs/council-update/prove.js";
import { CouncilUpdateVoteInput } from "../../../system/council/update/input.js";
import { EngineUpdateSpec } from "../../../system/engine-update/input.js";
import { CouncilMap } from "../../../system/council/data/council-map.js";
import { Seat } from "../../../system/council/seat.js";
import { describe, before, it } from "node:test";
import { FieldOperation } from "../../../system/engine-update/simple-operations.js";
import { deserializeProof, serializeProof } from "../../../proofs/serialization.js";



describe('JSON round-trip for Update proofs', () => {

    before(async () => {
    console.log('compiling zkpgrograms')
    await EngineUpdate.compile();
    await CouncilUpdate.compile();
    console.log('done')
    });
    
    /**
     * Checks that an EngineUpdate proof can be serialized to JSON and
     * deserialized back into a valid proof.
     *
     * This test is a sanity check for the JSON round-trip of EngineUpdate
     * proof objects. It creates a proof with a random protocol update
     * operation, serializes it to JSON, parses it back, deserializes it,
     * and checks that the resulting proof is equal to the original.
     */
    it('should be do a engine update json roundtrip without issues', async () => {
    const keys = PrivateKey.randomKeypair();
    const random = Poseidon.hash(keys.privateKey.toFields());
    const update = EngineUpdateSpec.empty();
    update.protocolUpdateOperation.newVerificationKey = FieldOperation.set(random);
    const councilMap = new CouncilMap([keys.publicKey]);
    const seat = Seat.fromIndex(0);
    const signature = Signature.create(keys.privateKey, update.toFields());
    const proofOriginal = await EngineUpdate.createVote(update, signature, keys.publicKey, councilMap.provable, seat);
    const proofSerialized = serializeProof(proofOriginal.proof);
    const proofJsonString = JSON.stringify(proofSerialized);
    //----------
    const proofJsonParsed = JSON.parse(proofJsonString);
    const proofDeserialized = await deserializeProof(proofJsonParsed, EngineUpdateVoteProof);

    const updateDeserialized = proofDeserialized.publicInput;
    Poseidon.hash(updateDeserialized.toFields()).assertEquals(Poseidon.hash(update.toFields()));
    const deserializedFields: Field[] = proofDeserialized.publicInput.toFields().concat(proofDeserialized.publicOutput.toFields());
    const originalFields: Field[] = proofOriginal.proof.publicInput.toFields().concat(proofOriginal.proof.publicOutput.toFields());
    for(let i =0 ; i< deserializedFields.length; i++) {
        deserializedFields[i].assertEquals(originalFields[i]);
    }
  });

  /**
   * Checks that a CouncilUpdate proof can be serialized to JSON and
   * deserialized back into a valid proof.
   *
   * This test is a sanity check for the JSON round-trip of CouncilUpdate
   * proof objects. It creates a proof with a random council update
   * operation, serializes it to JSON, parses it back, deserializes it,
   * and checks that the resulting proof is equal to the original.
   */
  it('should do a council update json roundtrip without issues', async () => {
    const keys = PrivateKey.randomKeypair();
    const keys2 = PrivateKey.randomKeypair();
    const updateInput = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
      new CouncilMap([keys.publicKey]),
      UInt8.from(2),
      [keys2.publicKey]
    );
    const seat = Seat.fromIndex(0);
    const signature = Signature.create(keys.privateKey, updateInput.councilManagementSpec.toFields());
    const proofOriginal = await CouncilUpdate.createVote(updateInput, signature, keys.publicKey, seat);
    const proofSerialized = serializeProof(proofOriginal.proof);
    const proofJsonString = JSON.stringify(proofSerialized);
    //----------
    const proofJsonParsed = JSON.parse(proofJsonString);
    const proofDeserialized = await deserializeProof(proofJsonParsed, CouncilUpdateVoteProof);

    const updateDeserialized = proofDeserialized.publicInput;
    Poseidon.hash(updateDeserialized.toFields()).assertEquals(Poseidon.hash(updateInput.toFields()));
    const deserializedFields: Field[] = proofDeserialized.publicInput.toFields().concat(proofDeserialized.publicOutput.cummulatedVoteBitArray.toFields()).concat(proofDeserialized.publicOutput.updatedCouncilMap.root.toFields());
    const originalFields: Field[] = proofOriginal.proof.publicInput.toFields().concat(proofOriginal.proof.publicOutput.cummulatedVoteBitArray.toFields()).concat(proofOriginal.proof.publicOutput.updatedCouncilMap.root.toFields());
    for(let i =0 ; i< deserializedFields.length; i++) {
      deserializedFields[i].assertEquals(originalFields[i]);
    }
  });

    
})
