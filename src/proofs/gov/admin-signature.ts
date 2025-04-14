// import {
//   FeatureFlags,
//   Field,
//   Poseidon,
//   PublicKey,
//   SelfProof,
//   Signature,
//   ZkProgram,
// } from 'o1js';
// import { ZkusdProtocolUpdateSpec } from '../../system/update/input.js';
// import { YesItIsAFinalZkusdProtocolUpdateProof, ZkusdProtocolUpdateOutput } from '../../system/update/output.js';

// /** Generic admin signature zkusd protocol update program */
// export const AdminSignatureZkusdProtocolUpdateProgram = ZkProgram({
//   name: 'AdminSignatureZkusdProtocolUpdateProgram',
//   publicInput: ZkusdProtocolUpdateSpec,
//   publicOutput: ZkusdProtocolUpdateOutput,
//   methods: {
//     merge: {
//       // only to make compatible with maxProofVerified = 2
//       privateInputs: [SelfProof, SelfProof],
//       async method(
//         publicInput: ZkusdProtocolUpdateSpec,
//         leftProof: SelfProof<
//           ZkusdProtocolUpdateSpec,
//           ZkusdProtocolUpdateOutput
//         >,
//         rightProof: SelfProof<
//           ZkusdProtocolUpdateSpec,
//           ZkusdProtocolUpdateOutput
//         >
//       ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
//         leftProof.verify();
//         rightProof.verify();

//         Poseidon.hash(
//           leftProof.publicInput.toFields()
//         ).assertEquals(
//           Poseidon.hash(
//           rightProof.publicInput.toFields()
//           )
//         );
//         leftProof.publicOutput.protocolUpdateHash.assertEquals(
//           rightProof.publicOutput.protocolUpdateHash
//         );

//         return { publicOutput: leftProof.publicOutput };
//       },
//     },
//     create: {
//       privateInputs: [Signature, PublicKey],
//       async method(
//         publicInput: ZkusdProtocolUpdateSpec,
//         updateSignature: Signature,
//         signaturePublicKey: PublicKey,
//       ): Promise<{ publicOutput: ZkusdProtocolUpdateOutput }> {
//         const proofDataFields = publicInput.toFields();
//         const protocolUpdateHash = Poseidon.hash(proofDataFields);

//         updateSignature
//           .verify(signaturePublicKey, proofDataFields)
//           .assertTrue();

//         return {
//           publicOutput: {
//             protocolUpdateHash,
//             auxilliaryOutput: [
//               Poseidon.hash(signaturePublicKey.toFields()),
//               Field.from(0),
//               Field.from(0),
//               Field.from(0),
//             ],
//             isFinalProof: YesItIsAFinalZkusdProtocolUpdateProof,
//           },
//         };
//       },
//     },
//   },
// });

// export const AdminSigFeatureFlags = await FeatureFlags.fromZkProgram(
//   AdminSignatureZkusdProtocolUpdateProgram
// );
