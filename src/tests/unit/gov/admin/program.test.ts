// import {
//   Field,
//   Poseidon,
//   PrivateKey,
//   PublicKey,
//   Signature,
//   verify /* assuming verify function for proofs exists */,
//   VerificationKey,
// } from 'o1js';
// import { describe, it, before } from 'node:test';
// import assert from 'node:assert/strict';
// import { AdminSignatureZkusdProtocolUpdateProgram } from '../../../../proofs/gov/admin-signature.js';
// import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
// import { YesItIsAFinalZkusdProtocolUpdateProof } from '../../../../system/update/output.js';
// import { BoolOperation } from '../../../../system/update/simple-operations.js';

// // --- Test Suite ---

// describe('AdminSignatureZkusdProtocolUpdateProgram', () => {
//   let adminPrivateKey: PrivateKey;
//   let adminPublicKey: PublicKey;
//   let updateInput: ZkusdProtocolUpdateSpec;
//   let updateInputFields: Field[];
//   let verificationKey: VerificationKey;

//   // Setup before tests run
//   before(async () => {
//     // Generate a key pair for the admin
//     adminPrivateKey = PrivateKey.random();
//     adminPublicKey = adminPrivateKey.toPublicKey();

//     // Create a sample input
//     updateInput = ZkusdProtocolUpdateSpec.empty();
//     updateInputFields = updateInput.toFields();

//     console.log('Compiling ZkProgram...');
//     const { verificationKey: vk } =
//       await AdminSignatureZkusdProtocolUpdateProgram.compile();
//     verificationKey = vk;
//     console.log('Compilation complete.');
//   });

//   // Test Case 1: Happy Path
//   it('should create a valid proof for a correct signature and public key', async () => {
//     // 1. Sign the correct input data with the correct private key
//     const validSignature = Signature.create(adminPrivateKey, updateInputFields);

//     // 2. Prove the program execution
//     console.log('Proving valid execution...');
//     const proof = await AdminSignatureZkusdProtocolUpdateProgram.create(
//       updateInput,
//       validSignature,
//       adminPublicKey
//     );
//     console.log('Proving complete.');

//     // 3. Verify the public output (optional but good)
//     const expectedOutputHash = Poseidon.hash(updateInputFields);

//     // Compare protocolUpdateHash (Field)
//     assert(
//       proof.proof.publicOutput.protocolUpdateHash
//         .equals(expectedOutputHash)
//         .toBoolean(),
//       'protocolUpdateHash did not match expected value'
//     );

//     // Compare isFinalProof (Field)
//     assert(
//       proof.proof.publicOutput.isFinalProof
//         .equals(YesItIsAFinalZkusdProtocolUpdateProof)
//         .toBoolean(),
//       'isFinalProof did not match expected value'
//     );
//     // Check auxilliaryOutput if needed

//     // 4. Verify the ZK proof itself
//     console.log('Verifying proof...');
//     const ok = await verify(proof.proof, verificationKey);
//     assert.strictEqual(ok, true, 'Expected verification to pass');
//     console.log('Verification successful.');
//   });

//   // Test Case 2: Invalid Signature (Doesn't Match Data)
//   it('should fail proof generation if the signature is for different data', async () => {
//     // 1. Create different input data/fields
//     const differentInput = ZkusdProtocolUpdateSpec.empty();
//     differentInput.protocolUpdateOperation.emergencyStop =
//       BoolOperation.mkFlip();
//     const differentInputFields = differentInput.toFields();

//     const fields1hash = Poseidon.hash(updateInputFields);
//     const fields2hash = Poseidon.hash(differentInputFields);
//     console.log('Hash of original fields:', fields1hash.toString());
//     console.log('Hash of different fields:', fields2hash.toString());
//     // must be different
//     assert.strictEqual(fields1hash.equals(fields2hash).toBoolean(), false);

//     // 2. Sign the *different* data with the correct private key
//     const signatureForDifferentData = Signature.create(
//       adminPrivateKey,
//       differentInputFields
//     );

//     // 3. Attempt to prove using the original input but the mismatched signature
//     console.log('Attempting proof with mismatched data signature...');
//     await assert.rejects(async () => {
//       const programx = await AdminSignatureZkusdProtocolUpdateProgram.create(
//         updateInput,
//         signatureForDifferentData,
//         adminPublicKey
//       );
//       verify(programx.proof, verificationKey);
//     });
//     console.log('Proof failed as expected.');
//   });

//   // Test Case 3: Invalid Signature (Wrong Public Key)
//   it('should fail proof generation if the public key does not match the signature', async () => {
//     // 1. Generate a *different* key pair
//     const wrongPrivateKey = PrivateKey.random();
//     const wrongPublicKey = wrongPrivateKey.toPublicKey();

//     // 2. Sign the correct data with the original admin private key
//     const validSignature = Signature.create(adminPrivateKey, updateInputFields);

//     // 3. Attempt to prove using the correct input/signature but the WRONG public key
//     console.log('Attempting proof with wrong public key...');
//     await assert.rejects(async () => {
//       await AdminSignatureZkusdProtocolUpdateProgram.create(
//         updateInput,
//         validSignature,
//         wrongPublicKey
//       );
//     });
//     console.log('Proof failed as expected.');
//   });

//   // Test Case 4: Corrupted Signature (Conceptual - Actual corruption depends on Signature structure)
//   // Note: Directly modifying o1js Signature fields might be tricky/not recommended.
//   // This might be better tested by ensuring the verify method itself is robust,
//   // but we can simulate a slightly altered signature structure if possible.
//   it('should potentially fail if the signature object is malformed (conceptual)', async () => {
//     // 1. Create a valid signature
//     const validSignature = Signature.create(adminPrivateKey, updateInputFields);

//     // 2. Create a malformed signature
//     const corruptedSignature = new Signature(
//       validSignature.s,
//       validSignature.r
//     );

//     // 3. Attempt to prove using the corrupted signature
//     console.log('Attempting proof with corrupted signature...');
//     await assert.rejects(async () => {
//       const program = await AdminSignatureZkusdProtocolUpdateProgram.create(
//         updateInput,
//         corruptedSignature,
//         adminPublicKey
//       );
//       verify(program.proof, verificationKey);
//     });
//     console.log('Proof failed as expected (due to corruption).');
//   });
// });
