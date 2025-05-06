import { Field, Poseidon, PrivateKey, Signature } from 'o1js';
import { EngineUpdate } from '../../../proofs/engine-update/prove.js';
import { EngineUpdateSpec } from '../../../system/engine-update/input.js';
import { CouncilMap } from '../../../system/council/data/council-map.js';
import { Seat } from '../../../system/council/seat.js';
import {
  deserializeEngineUpdateProof,
  serializeEngineUpdateProof,
} from '../../../proofs/engine-update/serialization.js';
import { describe, before, it } from 'node:test';
import { FieldOperation } from '../../../system/engine-update/simple-operations.js';

describe('JSON round-trip for Engine Update proofs', () => {
  before(async () => {
    console.log('compiling zkpgroam');
    await EngineUpdate.compile();
    console.log('done');
  });

  it('should be do a json roundtrip without issues', async () => {
    const keys = PrivateKey.randomKeypair();
    const random = Poseidon.hash(keys.privateKey.toFields());
    const update = EngineUpdateSpec.empty();
    update.protocolUpdateOperation.newVerificationKey =
      FieldOperation.set(random);
    const councilMap = new CouncilMap([keys.publicKey]);
    const seat = Seat.fromIndex(0);
    const signature = Signature.create(keys.privateKey, update.toFields());
    const proofOriginal = await EngineUpdate.createVote(
      update,
      signature,
      keys.publicKey,
      councilMap.provable,
      seat
    );
    const proofSerialized = serializeEngineUpdateProof(proofOriginal.proof);
    const proofJsonString = JSON.stringify(proofSerialized);
    //----------
    const proofJsonParsed = JSON.parse(proofJsonString);
    const proofDeserialized =
      await deserializeEngineUpdateProof(proofJsonParsed);

    const updateDeserialized = proofDeserialized.publicInput;
    Poseidon.hash(updateDeserialized.toFields()).assertEquals(
      Poseidon.hash(update.toFields())
    );
    const deserializedFields: Field[] = proofDeserialized.publicInput
      .toFields()
      .concat(proofDeserialized.publicOutput.toFields());
    const orignalFields: Field[] = proofOriginal.proof.publicInput
      .toFields()
      .concat(proofOriginal.proof.publicOutput.toFields());
    for (let i = 0; i < deserializedFields.length; i++) {
      deserializedFields[i].assertEquals(orignalFields[i]);
    }
  });
});
