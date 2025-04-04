// import { AccountUpdate, Bool, PrivateKey, Signature, UInt32 } from 'o1js';
// import { describe, it, before } from 'node:test';
// import assert from 'node:assert';

// import { TestHelper, TestAmounts } from '../../../test-helper.js';
// import {
//   MinaChainPreconditions,
//   ZkusdProtocolPreconditions,
//   zkusdProtocolUpdateInputToFields,
// } from '../../../../system/update.js';
// import { verificationKeys } from '../../../../config/verification-keys.js';
// import {
//   ZkusdGovResolutionProgramWitness,
//   mkZkusdGovResolutionProgramTree,
// } from '../../../../system/governance.js';
// import { toggleEmergencyStop, updateProtocolEmergencyStop } from '../utils.js';
// import { BoolOperation } from '../../../../system/update-operations.js';
// import {
//   BoolPrecondition,
//   // If you have a numeric precondition for block slots, import it here:
//   // NumericPrecondition
// } from '../../../../system/preconditions.js';
// import { AdminSignatureZkusdProtocolUpdateProgram } from '../../../../proofs/gov/admin-signature.js';
// import { ZkusdProtocolUpdateProof } from '../../../../system/update-proof.js';

// describe('zkUSD Government Admin Signature Tests', () => {
//   let testHelper: TestHelper<'local'>;
//   const newAdminKeypair = PrivateKey.randomKeypair();

//   /**
//    * Helper function to create an admin signature proof for protocol updates.
//    * Adjust the type of `updateInput` if you have a specific type in your codebase.
//    */
//   async function createAdminSigProof(updateInput: any) {
//     const { protocolAdmin } = testHelper.networkKeys;
//     const signature = Signature.create(
//       protocolAdmin.privateKey,
//       zkusdProtocolUpdateInputToFields(updateInput)
//     );

//     const proofResult = await AdminSignatureZkusdProtocolUpdateProgram.create(
//       updateInput,
//       signature,
//       protocolAdmin.privateKey.toPublicKey(),
//     );

//     return {
//       sideLoadedProof: ZkusdProtocolUpdateProof.fromProof(proofResult.proof),
//       verificationKey: verificationKeys.adminSigProgram,
//       witness: new ZkusdGovResolutionProgramWitness(
//         mkZkusdGovResolutionProgramTree().getWitness(0n)
//       ),
//     };
//   }

//   before(async () => {
//     // Initialize test environment
//     testHelper = await TestHelper.initLocalChain({ proofsEnabled: false });
//     await testHelper.deployTokenContracts();

//     // Create Alice & Bob agents; also create a vault for Alice
//     await testHelper.createLocalAgents('alice');
//     await testHelper.createVaults('alice');
//     await testHelper.createLocalAgents('bob');

//     // Alice deposits 100 MINA for the initial setup
//     await testHelper.includeTx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.depositCollateral(
//           testHelper.agents.alice.vault!.publicKey,
//           TestAmounts.COLLATERAL_100_MINA
//         );
//       },
//       { name: 'Alice deposits 100 MINA into her vault' }
//     );

//     // Fund creation of a new admin account
//     await testHelper.includeTx(
//       testHelper.agents.alice.keys,
//       async () => {
//         AccountUpdate.fundNewAccount(testHelper.agents.alice.keys.publicKey, 1);
//         AccountUpdate.create(newAdminKeypair.publicKey);
//       },
//       { name: 'Alice funds new admin key creation' }
//     );
//   });

//   it('should allow the gov admin to stop the protocol', async () => {
//     // Confirm the protocol is currently running
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//     assert.equal(isStopped, false, 'Protocol should initially be running');

//     // Prepare inputs and proof to toggle the emergency stop
//     const updateInput = toggleEmergencyStop();
//     const { sideLoadedProof, verificationKey, witness } =
//       await createAdminSigProof(updateInput);

//     // Execute transaction to stop the protocol
//     await testHelper.includeTx(
//       testHelper.agents.alice.keys,
//       async () => {
//         await testHelper.engine.contract.govToggleEmergencyStop(
//           verificationKey,
//           witness,
//           sideLoadedProof
//         );
//       },
//       { name: 'Alice stops protocol using an admin signature update' }
//     );

//     // Verify the protocol is now stopped
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//     assert.equal(isStopped, true, 'Protocol should now be stopped');
//   });

//   it('should not allow the gov admin to start the protocol with stop proof', async () => {
//     // Confirm the protocol is currently stopped
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//     assert.equal(isStopped, true, 'Protocol should be stopped');

//     // now we can create the proof of admin signature
//     const updateInput = updateProtocolEmergencyStop({
//       emergencyStopOperation: BoolOperation.mkFlip(),
//       protocolPreconditions: ZkusdProtocolPreconditions.create({
//         emergencyStop: BoolPrecondition.mkMustEqual(false), // it requires the protocol to be running, but it's not
//       }),
//     });

//     const { sideLoadedProof, verificationKey, witness } =
//       await createAdminSigProof(updateInput);

//     // This transaction should fail because the precondition contradicts reality
//     await assert.rejects(async () => {
//       await testHelper.includeTx(
//         testHelper.agents.alice.keys,
//         async () => {
//           await testHelper.engine.contract.govToggleEmergencyStop(
//             verificationKey,
//             witness,
//             sideLoadedProof
//           );
//         },
//         {
//           name: 'Alice attempts to start protocol with an invalid proof precondition',
//         }
//       );
//     }, 'Expected transaction to fail but it succeeded.');

//     // Verify the protocol remains stopped
//     await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
//       force: true,
//     });
//     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//     assert.equal(isStopped, true, 'Protocol should still be stopped');
//   });
//   describe('Blockchain Length Precondition Tests (Bob)', () => {
//     // Suppose we require the chain length to be >= 1010 to start
//     const requiredChainLength = 1010;

//     it("Bob can't start the protocol if the blockchain length is below the required threshold", async () => {
//       // Confirm the protocol is still stopped from previous tests
//       await testHelper.mina.fetchMinaAccount(
//         testHelper.engine.contract.address,
//         { force: true }
//       );
//       let isStopped = testHelper.engine.contract
//         .isEmergencyStopped()
//         .toBoolean();
//       assert.equal(isStopped, true, 'Protocol should currently be stopped');

//       // Create an update input that tries to start the protocol (set emergencyStop = false)
//       // but also requires the current blockchain length to be >= requiredChainLength
//       const updateInput = updateProtocolEmergencyStop({
//         // these fields might differ based on your updateProtocolEmergencyStop signature
//         blockchainPreconditions: MinaChainPreconditions.blockchainLength(
//           UInt32.from(requiredChainLength),
//           UInt32.from(2000)
//         ),
//         emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
//         protocolPreconditions: ZkusdProtocolPreconditions.create({
//           // Protocol is currently stopped => mustEqual(true)
//           emergencyStop: BoolPrecondition.mkMustEqual(true),
//         }),
//       });

//       // Create the proof signed by the actual protocol admin
//       const { sideLoadedProof, verificationKey, witness } =
//         await createAdminSigProof(updateInput);

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
//             name: "Bob attempts to start protocol but blockchain length hasn't reached the threshold",
//           }
//         );
//       }, 'Expected transaction to fail but it succeeded.');

//       // The protocol should remain stopped
//       await testHelper.mina.fetchMinaAccount(
//         testHelper.engine.contract.address,
//         { force: true }
//       );
//       isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//       assert.equal(isStopped, true, 'Protocol should remain stopped');
//     });

//     it('Bob can start the protocol once the blockchain length threshold is reached', async () => {
//       // Move the chain forward until we satisfy the required length (from previous test).
//       // If we started at 1000, and need 1010, move 10 blocks forward:
//       await testHelper.mina.moveChainForward(10);

//       // The same updateInput from the previous test can be reused,
//       // or you can recreate it for clarity:
//       const updateInput = updateProtocolEmergencyStop({
//         emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
//         blockchainPreconditions: MinaChainPreconditions.blockchainLength(
//           UInt32.from(requiredChainLength),
//           UInt32.from(2000)
//         ),
//         protocolPreconditions: ZkusdProtocolPreconditions.create({
//           // protocol is currently stopped => mustEqual(true)
//           emergencyStop: BoolPrecondition.mkMustEqual(true),
//           // blockchainLength: NumericPrecondition.mkMustBeGreaterOrEqual(1010),
//         }),
//       });

//       const { sideLoadedProof, verificationKey, witness } =
//         await createAdminSigProof(updateInput);

//       // Now the chain length should be >= 1010, so the transaction ought to succeed
//       await testHelper.includeTx(
//         testHelper.agents.bob.keys,
//         async () => {
//           await testHelper.engine.contract.govToggleEmergencyStop(
//             verificationKey,
//             witness,
//             sideLoadedProof
//           );
//         },
//         {
//           name: 'Bob successfully starts protocol after blockchain length threshold is met',
//         }
//       );

//       // Verify the protocol is now running
//       await testHelper.mina.fetchMinaAccount(
//         testHelper.engine.contract.address,
//         { force: true }
//       );
//       const isStopped = testHelper.engine.contract
//         .isEmergencyStopped()
//         .toBoolean();
//       assert.equal(isStopped, false, 'Protocol should now be running');
//     });
//   });
//   // ========================================================================
//   // CURRENT SLOT IS ALWAYS 0 IN LOCAL TESTS
//   // ========================================================================
//   //
//   // New Tests for Bob and Block Slot Preconditions
//   //
//   // describe('Block Slot Precondition Tests (Bob)', () => {
//   //   it("Bob can't start the protocol if the block slot is below the required threshold", async () => {
//   //     // Confirm the protocol is still stopped from previous tests
//   //     await testHelper.mina.fetchMinaAccount(
//   //       testHelper.engine.contract.address,
//   //       { force: true }
//   //     );
//   //     let isStopped = testHelper.engine.contract
//   //       .isEmergencyStopped()
//   //       .toBoolean();
//   //     assert.equal(isStopped, true, 'Protocol should currently be stopped');

//   //     // Suppose we require the chain slot to be >= 10 to start
//   //     const requiredSlot = 10;

//   //     // Create an update input that tries to start the protocol (set emergencyStop = false)
//   //     // but also requires the current block slot to be >= requiredSlot
//   //     const updateInput = updateProtocolEmergencyStop({
//   //       firstSlotIndex: requiredSlot,
//   //       lastSlotIndex: 1000,
//   //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
//   //       protocolPreconditions: ZkusdProtocolPreconditions.create({
//   //         // protocol is currently stopped => mustEqual(true)
//   //         emergencyStop: BoolPrecondition.mkMustEqual(true),
//   //         // This numeric precondition is hypothetical; adapt to your code if needed
//   //         // blockSlot: NumericPrecondition.mkMustBeGreaterOrEqual(requiredSlot),
//   //       }),
//   //     });

//   //     // Create the proof signed by the actual protocol admin
//   //     const { sideLoadedProof, verificationKey, witness } =
//   //       await createAdminSigProof(updateInput);

//   //     // Bob includes the transaction, but if the chain slot is < requiredSlot,
//   //     // the transaction should fail due to unmet precondition
//   //     await assert.rejects(async () => {
//   //       await testHelper.includeTx(
//   //         testHelper.agents.bob.keys, // Bob is the sender
//   //         async () => {
//   //           await testHelper.engine.contract.govStopProtocol(
//   //             verificationKey,
//   //             witness,
//   //             sideLoadedProof
//   //           );
//   //         },
//   //         {
//   //           name: "Bob attempts to start protocol but block slot hasn't reached the threshold",
//   //         }
//   //       );
//   //     }, 'Expected transaction to fail but it succeeded.');

//   //     // The protocol should remain stopped
//   //     await testHelper.mina.fetchMinaAccount(
//   //       testHelper.engine.contract.address,
//   //       { force: true }
//   //     );
//   //     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
//   //     assert.equal(isStopped, true, 'Protocol should remain stopped');
//   //   });

//   //   it('Bob can start the protocol once the block slot threshold is reached', async () => {
//   //     // Move the chain forward until we satisfy the required slot (from previous test)
//   //     // Increase this number if you know your current slot.
//   //     await testHelper.mina.moveChainForward(10);

//   //     // The same updateInput from the previous test can be reused,
//   //     // or you can recreate it for clarity:
//   //     const updateInput = updateProtocolEmergencyStop({
//   //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
//   //       firstSlotIndex: 10,
//   //       lastSlotIndex: 1000,
//   //       protocolPreconditions: ZkusdProtocolPreconditions.create({
//   //         // protocol is currently stopped => mustEqual(true)
//   //         emergencyStop: BoolPrecondition.mkMustEqual(true),
//   //       }),
//   //     });

//   //     const { sideLoadedProof, verificationKey, witness } =
//   //       await createAdminSigProof(updateInput);

//   //     // Now the chain slot should be >= 10, so the transaction ought to succeed
//   //     await testHelper.includeTx(
//   //       testHelper.agents.bob.keys,
//   //       async () => {
//   //         await testHelper.engine.contract.govStopProtocol(
//   //           verificationKey,
//   //           witness,
//   //           sideLoadedProof
//   //         );
//   //       },
//   //       {
//   //         name: 'Bob successfully starts protocol after slot threshold is met',
//   //       }
//   //     );

//   //     // Verify the protocol is now running
//   //     await testHelper.mina.fetchMinaAccount(
//   //       testHelper.engine.contract.address,
//   //       { force: true }
//   //     );
//   //     const isStopped = testHelper.engine.contract
//   //       .isEmergencyStopped()
//   //       .toBoolean();
//   //     assert.equal(isStopped, false, 'Protocol should now be running');
//   //   });
//   // });
// });
