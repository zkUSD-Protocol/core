import {
  FeatureFlags,
  Field,
  Poseidon,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import { ZkusdProtocolUpdateInput } from '../../system/update/input.js';
import { YesItIsAFinalZkusdProtocolUpdateProof, ZkusdProtocolUpdateOutput } from '../../system/update/output.js';

/** Generic admin signature zkusd protocol update program */
export const AdminSignatureZkusdProtocolUpdateProgram = ZkProgram({
  name: 'AdminSignatureZkusdProtocolUpdateProgram',
  publicInput: ZkusdProtocolUpdateInput,
  publicOutput: ZkusdProtocolUpdateOutput,
  methods: {
    merge: {
      // only to make compatible with maxProofVerified = 2
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

        Poseidon.hash(
          leftProof.publicInput.toFields()
        ).assertEquals(
          Poseidon.hash(
          rightProof.publicInput.toFields()
          )
        );
        leftProof.publicOutput.protocolUpdateHash.assertEquals(
          rightProof.publicOutput.protocolUpdateHash
        );

        return { publicOutput: leftProof.publicOutput };
      },
    },
    create: {
      privateInputs: [Signature, PublicKey],
      async method(
        publicInput: ZkusdProtocolUpdateInput,
        updateSignature: Signature,
        signaturePublicKey: PublicKey,
      ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
        const proofDataFields = publicInput.toFields();
        const protocolUpdateHash = Poseidon.hash(proofDataFields);

        updateSignature
          .verify(signaturePublicKey, proofDataFields)
          .assertTrue();

        return {
          publicOutput: {
            protocolUpdateHash,
            auxilliaryOutput: [
              Poseidon.hash(signaturePublicKey.toFields()),
              Field.from(0),
              Field.from(0),
              Field.from(0),
            ],
            isFinalProof: YesItIsAFinalZkusdProtocolUpdateProof,
          },
        };
      },
    },
  },
});

export const AdminSigFeatureFlags = await FeatureFlags.fromZkProgram(
  AdminSignatureZkusdProtocolUpdateProgram
);
