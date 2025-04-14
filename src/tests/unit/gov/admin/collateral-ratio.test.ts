// import {
//   Field,
//   PrivateKey,
//   Provable,
//   Signature,
//   UInt32,
//   UInt8,
//   VerificationKey,
// } from 'o1js';
// import { describe, it, before } from 'node:test';
// import assert from 'node:assert';

// import { TestHelper } from '../../../test-helper.js';
// import { verificationKeys } from '../../../../config/verification-keys.js';
// import {
//   ZkusdGovResolutionProgramWitness,
//   mkZkusdGovResolutionProgramTree,
// } from '../../../../system/governance.js';
// import { AdminSignatureZkusdProtocolUpdateProgram } from '../../../../proofs/gov/admin-signature.js';
// import { measurePerformance } from '../utils.js';
// import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
// import { ZkusdProtocolUpdateProof } from '../../../../system/update/proof.js';
// import { UInt8Precondition } from '../../../../system/update/simple-preconditions.js';
// import { ZkusdProtocolPreconditions } from '../../../../system/update/protocol-preconditions.js';
// import { ZkusdProtocolUpdateOperation } from '../../../../system/update/operation.js';
// import { UInt8Operation } from '../../../../system/update/simple-operations.js';
// import { MinaChainPreconditions } from '../../../../system/update/blockchain-preconditions.js';

// describe('zkUSD Government Admin Signature Tests', () => {
//   let testHelper: TestHelper<'local'>;

//   let previousProofData: {
//     sideLoadedProof: ZkusdProtocolUpdateProof;
//     verificationKey: VerificationKey;
//     witness: ZkusdGovResolutionProgramWitness;
//   };

//   async function createSigProof(updateInput: any, privateKey: PrivateKey) {
//     const signature = Signature.create(privateKey, updateInput.toFields());

//     const proofResult = await AdminSignatureZkusdProtocolUpdateProgram.create(
//       updateInput,
//       signature,
//       privateKey.toPublicKey()
//     );

//     return {
//       sideLoadedProof: ZkusdProtocolUpdateProof.fromProof(proofResult.proof),
//       verificationKey: verificationKeys.adminSigProgram,
//       witness: new ZkusdGovResolutionProgramWitness(
//         mkZkusdGovResolutionProgramTree().getWitness(0n)
//       ),
//     };
//   }
//   async function createInvalidSigProof(
//     updateInput: any,
//     privateKey: PrivateKey
//   ) {
//     const signature = Signature.create(privateKey, updateInput.toFields());
//     signature.r = signature.r.add(Field.from(1));

//     const proofResult = await AdminSignatureZkusdProtocolUpdateProgram.create(
//       updateInput,
//       signature,
//       privateKey.toPublicKey()
//     );

//     return {
//       sideLoadedProof: ZkusdProtocolUpdateProof.fromProof(proofResult.proof),
//       verificationKey: verificationKeys.adminSigProgram,
//       witness: new ZkusdGovResolutionProgramWitness(
//         mkZkusdGovResolutionProgramTree().getWitness(0n)
//       ),
//     };
//   }

//   async function createAdminSigProof(updateInput: any) {
//     const { protocolAdmin } = testHelper.networkKeys;
//     return createSigProof(updateInput, protocolAdmin.privateKey);
//   }

//   before(async () => {
//     // Initialize test environment
//     testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
//     await testHelper.deployTokenContracts();

//     await testHelper.createLocalAgents('alice');
//     await testHelper.createLocalAgents('bob');
//   });

//   it('should allow the update proof to change the collateral ratio', async () => {
//     // Confirm the protocol is currently running
//     Provable.log('fetching engine account');
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//     assert.equal(isStopped, false, 'Protocol should initially be running');
//     Provable.log('protocol is not stopped, able to continue');

//     Provable.log('preparing update input');

//     const updateInput = ZkusdProtocolUpdateSpec.singleOperation(
//       0,
//       ZkusdProtocolUpdateOperation.mkFromPartial({
//         collateralRatio: UInt8Operation.mkSetTo(UInt8.from(155)),
//       }),
//       {
//         protocolPreconditions: ZkusdProtocolPreconditions.create({
//           collateralRatio: UInt8Precondition.mkDifferentThan(UInt8.from(155)),
//         }),
//       }
//     );

//     const { sideLoadedProof, verificationKey, witness } =
//       await measurePerformance('Creating the proof', async () => {
//         return createAdminSigProof(updateInput);
//       });

//     previousProofData = { sideLoadedProof, verificationKey, witness };

//     await measurePerformance(
//       'including the transaction to change the collateral ratio',
//       async () =>
//         await testHelper.includeTx(
//           testHelper.agents.alice.keys,
//           async () => {
//             await testHelper.engine.contract.govUpdateCollateralRatio(
//               sideLoadedProof,
//               verificationKey,
//               witness
//             );
//           },
//           {
//             name: 'Alice changes the collateral ratio using an admin signature update',
//           }
//         )
//     );
//     // Verify the new protocol ratio
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     const protocolData = await testHelper.engine.contract.getProtocolData();
//     assert.equal(
//       protocolData.collateralRatio.toNumber(),
//       155,
//       'Collateral ratio should be 155'
//     );
//   });

//   it('should not allow to reuse proof because preconditions have changed.', async () => {
//     await assert.rejects(
//       async () =>
//         await measurePerformance(
//           'including the transaction to change the collateral ratio',
//           async () =>
//             await testHelper.includeTx(
//               testHelper.agents.alice.keys,
//               async () => {
//                 await testHelper.engine.contract.govUpdateCollateralRatio(
//                   previousProofData.sideLoadedProof,
//                   previousProofData.verificationKey,
//                   previousProofData.witness
//                 );
//               },
//               {
//                 name: 'Alice changes the collateral ratio using an admin signature update',
//               }
//             )
//         )
//     );
//   });

//   it('should not allow to update with tampered data.', async () => {
//     const updateInput = ZkusdProtocolUpdateSpec.singleOperation(
//       1,
//       ZkusdProtocolUpdateOperation.mkFromPartial({
//         collateralRatio: UInt8Operation.mkSetTo(UInt8.from(150)),
//       }),
//       {
//         protocolPreconditions: ZkusdProtocolPreconditions.create({
//           collateralRatio: UInt8Precondition.mkEqual(UInt8.from(155)),
//         }),
//       }
//     );

//     const { sideLoadedProof, verificationKey, witness } =
//       await measurePerformance('Creating the proof', async () => {
//         return createAdminSigProof(updateInput);
//       });

//     // change the data - the signature will become invalid
//     sideLoadedProof.publicInput.govResolutionIndex = UInt32.from(0);

//     await assert.rejects(
//       async () =>
//         await measurePerformance(
//           'including the transaction to change the collateral ratio',
//           async () =>
//             await testHelper.includeTx(
//               testHelper.agents.alice.keys,
//               async () => {
//                 await testHelper.engine.contract.govUpdateCollateralRatio(
//                   sideLoadedProof,
//                   verificationKey,
//                   witness
//                 );
//               },
//               {
//                 name: 'Alice tries to tamper the proof data',
//               }
//             )
//         )
//     );
//     // Verify the new protocol ratio
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     const protocolData = await testHelper.engine.contract.getProtocolData();
//     assert.equal(
//       protocolData.collateralRatio.toNumber(),
//       155,
//       'Collateral ratio should be 155'
//     );
//   });

//   it('should not allow to update with tampered signature', async () => {
//     const updateInput = ZkusdProtocolUpdateSpec.singleOperation(
//       1,
//       ZkusdProtocolUpdateOperation.mkFromPartial({
//         collateralRatio: UInt8Operation.mkSetTo(UInt8.from(150)),
//       }),
//       {
//         protocolPreconditions: ZkusdProtocolPreconditions.create({
//           collateralRatio: UInt8Precondition.mkEqual(UInt8.from(155)),
//         }),
//       }
//     );

//     await assert.rejects(
//       async () =>
//         await measurePerformance('Creating the proof', async () => {
//           return createInvalidSigProof(
//             updateInput,
//             testHelper.networkKeys.protocolAdmin.privateKey
//           );
//         })
//     );
//   });

//   describe('Blockchain Length Precondition Tests (Bob)', () => {
//     // Suppose we require the chain length to be >= 1010 to start
//     const requiredChainLength = 1010;

//     it("Bob can't use proof if the blockchain length precondition fails", async () => {
//       const updateInput = ZkusdProtocolUpdateSpec.singleOperation(
//         1,
//         ZkusdProtocolUpdateOperation.mkFromPartial({
//           collateralRatio: UInt8Operation.mkSetTo(UInt8.from(150)),
//         }),
//         {
//           blockchainPreconditions: MinaChainPreconditions.blockchainLength(
//             UInt32.from(requiredChainLength)
//           ),
//         }
//       );

//       // Create the proof signed by the actual protocol admin
//       const { sideLoadedProof, verificationKey, witness } =
//         await createAdminSigProof(updateInput);

//       previousProofData = { sideLoadedProof, verificationKey, witness };

//       // Bob includes the transaction, but if the blockchain length is < requiredChainLength,
//       // the transaction should fail due to the unmet precondition
//       await assert.rejects(async () => {
//         await testHelper.includeTx(
//           testHelper.agents.bob.keys, // Bob is the sender
//           async () => {
//             await testHelper.engine.contract.govToggleEmergencyStop(
//               verificationKey,
//               witness,
//               sideLoadedProof
//             );
//           },
//           {
//             name: "Bob attempts to change collateral ratio with proof but is not valid yet",
//           }
//         );
//       }, 'Expected transaction to fail but it succeeded.');
//     });

//     it('Bob can use proof if the blockchain length precondition fails', async () => {
//       // Bob includes the transaction, but if the blockchain length is < requiredChainLength,
//       // the transaction should fail due to the unmet precondition
//       await testHelper.mina.moveChainForward(11);
//         await testHelper.includeTx(
//           testHelper.agents.bob.keys, // Bob is the sender
//           async () => {
//             await testHelper.engine.contract.govToggleEmergencyStop(
//               previousProofData.verificationKey,
//               previousProofData.witness,
//               previousProofData.sideLoadedProof
//             );
//           },
//           {
//             name: "Bob attempts to changet collateral ratio with proof once its valid.",
//           }
//         );
//     });
//   });
// });
