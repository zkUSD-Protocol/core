import {
  FeatureFlags,
  Field,
  Poseidon,
  PublicKey,
  SelfProof,
  Signature,
  ZkProgram,
} from 'o1js';
import {
  YesItIsAFinalZkusdProtocolUpdateProof,
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput,
  zkusdProtocolUpdateInputToFields,
} from '../../system/update.js';

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
          zkusdProtocolUpdateInputToFields(leftProof.publicInput)
        ).assertEquals(
          Poseidon.hash(zkusdProtocolUpdateInputToFields(publicInput))
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
        const proofDataFields = zkusdProtocolUpdateInputToFields(publicInput);
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

export const AdminSigFeautureFlags = await FeatureFlags.fromZkProgram(
  AdminSignatureZkusdProtocolUpdateProgram
);
