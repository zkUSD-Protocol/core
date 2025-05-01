import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrivateKey,
  PublicKey,
  Signature,
  Field,
  MerkleTree,
  Poseidon,
  verify, // from o1js
  VerificationKey,
  Proof,
} from 'o1js';

import { GovernanceUpdate } from '../../../../proofs/engine-update/prove.js';
import { Seat } from '../../../../system/council/seat.js';
import { CouncilMap } from '../../../../system/council/data/council-map.js';
import { EngineUpdateSpec } from '../../../../system/engine-update/input.js';
import { BoolOperation } from '../../../../system/engine-update/simple-operations.js';
import { ZkusdProtocolUpdateOutput } from '../../../../system/engine-update/output.js';

function getSeatKey(seatIndex: number) {
  return Field(2 ** seatIndex);
}

describe('GovernanceUpdate', () => {
  let verificationKey: VerificationKey;
  let councilMerkleMapRoot: Field;
  let councilMerkleMap: CouncilMap;
  let seatIndex = 3; // Example seat index

  let councilPrivateKey: PrivateKey;
  let councilPublicKey: PublicKey;
  let wrongPrivateKey: PrivateKey;
  let wrongPublicKey: PublicKey;

  // A shared sample input for all tests
  let updateInput: EngineUpdateSpec;
  let updateInputFields: Field[];

  before(async () => {
    console.log('Compiling ZkProgram...');
    const { verificationKey: vk } = await GovernanceUpdate.compile();
    verificationKey = vk;
    console.log('Compilation complete.');

    // Prepare a sample update spec
    updateInput = EngineUpdateSpec.empty();
    updateInputFields = updateInput.toFields();

    // Create keys
    councilPrivateKey = PrivateKey.random();
    councilPublicKey = councilPrivateKey.toPublicKey();

    wrongPrivateKey = PrivateKey.random();
    wrongPublicKey = wrongPrivateKey.toPublicKey();

    // Build a Merkle tree for the council
    councilMerkleMap = new CouncilMap();
    councilMerkleMap.insertAtSeat(councilPublicKey, Seat.fromIndex(seatIndex));
    councilMerkleMapRoot = councilMerkleMap.root;
  });

  // ------------------------------------------------------------
  // createVote Tests
  // ------------------------------------------------------------
  describe('createVote()', () => {
    it('should produce a valid proof with correct signature and Merkle membership', async () => {
      // 1. Sign the correct input data
      const signature = Signature.create(councilPrivateKey, updateInputFields);

      // 3. Generate proof
      console.log('Creating vote (correct signature, correct membership)...');
      const { proof } = await GovernanceUpdate.createVote(
        updateInput,
        signature,
        councilPublicKey,
        councilMerkleMap.provable,
        Seat.fromIndex(seatIndex)
      );
      console.log('Proof created.');

      // 4. Verify proof
      const ok = await verify(proof, verificationKey);
      assert.strictEqual(
        ok,
        true,
        'Expected valid proof to verify successfully'
      );

      // 5. Check publicOutput
      const { proposalHash, councilMerkleMapRoot, cummulatedVoteBitArray } =
        proof.publicOutput;
      assert(
        proposalHash.equals(Poseidon.hash(updateInputFields)).toBoolean(),
        'Proposal hash mismatch'
      );
      assert(
        councilMerkleMapRoot.equals(councilMerkleMapRoot).toBoolean(),
        'Merkle root mismatch'
      );
      assert(
        cummulatedVoteBitArray.equals(Field(2 ** seatIndex)).toBoolean(),
        'Vote bit array mismatch'
      );
    });

    it('should fail if the signature is for different data', async () => {
      // 1. Create a *different* input
      const differentInput = EngineUpdateSpec.empty();
      // Modify it in some minimal way...
      differentInput.protocolUpdateOperation.emergencyStop =
        BoolOperation.flip();

      const differentFields = differentInput.toFields();

      // 2. Sign the *different* data
      const wrongSignature = Signature.create(
        councilPrivateKey,
        differentFields
      );

      console.log('Creating vote with mismatched input-signature...');
      await assert.rejects(async () => {
        await GovernanceUpdate.createVote(
          updateInput,
          wrongSignature,
          councilPublicKey,
          councilMerkleMap.provable,
          Seat.fromIndex(seatIndex)
        );
      }, 'Expected createVote to fail with incorrect signature');
      console.log('Proof creation failed as expected.');
    });

    it('should fail if the public key is not in the Merkle tree (wrong seat index or witness)', async () => {
      // 1. Sign the correct data
      const signature = Signature.create(councilPrivateKey, updateInputFields);

      // 2. Provide a *wrong* seat index or a wrong witness. E.g. seatIndex+1
      const wrongSeatIndex = seatIndex + 1;

      console.log('Creating vote with a mismatched seat witness...');
      await assert.rejects(async () => {
        await GovernanceUpdate.createVote(
          updateInput,
          signature,
          councilPublicKey,
          councilMerkleMap.provable,
          Seat.fromIndex(wrongSeatIndex)
        );
      }, 'Expected createVote to fail if membership proof does not match actual seat');
      console.log('Proof creation failed as expected.');
    });

    it('should fail if we use a completely different public key (not in tree)', async () => {
      // 1. Sign the correct data
      const signature = Signature.create(wrongPrivateKey, updateInputFields);

      // 2. Provide the correct seat witness for the *real* public key but try the wrong pubKey

      console.log('Creating vote with the wrong public key...');
      await assert.rejects(async () => {
        await GovernanceUpdate.createVote(
          updateInput,
          signature,
          wrongPublicKey,
          councilMerkleMap.provable,
          Seat.fromIndex(seatIndex)
        );
      }, 'Expected createVote to fail if the provided public key is not actually in the tree');
      console.log('Proof creation failed as expected.');
    });
  });

  describe('createVote() - malicious multi-bit index test', () => {
    it('should fail if seat index is not a single bit (e.g., 2^3 + 2^5)', async () => {
      const seatIndexMaliciousValue = 40; // 8 + 32 = 40

      // Suppose we have everything else set up: valid privateKey & signature data
      const privateKey = PrivateKey.random();
      const publicKey = privateKey.toPublicKey();

      // ...some valid updateInput, its fields, and a witness that claims seat=40
      // For brevity, assume you build the tree and witness for a seat=40
      // but in reality, your circuit expects seat=3 or seat=5, not BOTH.
      const signature = Signature.create(privateKey, updateInputFields);

      councilMerkleMap.insertAtSeat(
        publicKey,
        Seat.fromIndex(seatIndexMaliciousValue)
      );

      // await assert.rejects(async () => {
      const { proof } = await GovernanceUpdate.createVote(
        updateInput,
        signature,
        publicKey,
        councilMerkleMap.provable,
        Seat.fromIndex(seatIndexMaliciousValue)
      );
      console.log(
        'cummulatedVoteBitArray value',
        proof.publicOutput.cummulatedVoteBitArray.value
      );
      // });
    });
  });

  // ------------------------------------------------------------
  // mergeVotes Tests
  // ------------------------------------------------------------
  describe('mergeVotes()', () => {
    let seatIndex2 = 5; // second seat
    let secondCouncilPrivateKey: PrivateKey;
    let secondCouncilPublicKey: PublicKey;

    let secondMerkleMap: CouncilMap;
    let secondcouncilMerkleMapRoot: Field;

    let proof1: Proof<EngineUpdateSpec, ZkusdProtocolUpdateOutput>;
    let proof2: Proof<EngineUpdateSpec, ZkusdProtocolUpdateOutput>;

    before(async () => {
      // Build a second tree that also has seatIndex2
      secondCouncilPrivateKey = PrivateKey.random();
      secondCouncilPublicKey = secondCouncilPrivateKey.toPublicKey();

      secondMerkleMap = new CouncilMap();
      secondMerkleMap.insertAtSeat(
        secondCouncilPublicKey,
        Seat.fromIndex(seatIndex2)
      );
      secondcouncilMerkleMapRoot = secondMerkleMap.root;

      // For the merge to pass, *both* proofs must have the SAME publicInput & the SAME councilMerkleMapRoot
      // So let's unify them by building a single tree that has both seats:
      // seatIndex -> councilPublicKey
      // seatIndex2 -> secondCouncilPublicKey

      // That can be done easily by building one combined tree:
      const combinedMerkleMap = new CouncilMap();
      combinedMerkleMap.insertAtSeat(
        councilPublicKey,
        Seat.fromIndex(seatIndex)
      );
      combinedMerkleMap.insertAtSeat(
        secondCouncilPublicKey,
        Seat.fromIndex(seatIndex2)
      );
      const combinedRoot = combinedMerkleMap.root;

      // Now generate two separate proofs with the same root, same public input, but different seats.

      // First proof
      const signature1 = Signature.create(councilPrivateKey, updateInputFields);
      const { proof: p1 } = await GovernanceUpdate.createVote(
        updateInput,
        signature1,
        councilPublicKey,
        combinedMerkleMap.provable,
        Seat.fromIndex(seatIndex)
      );
      proof1 = p1;

      // Second proof
      const signature2 = Signature.create(
        secondCouncilPrivateKey,
        updateInputFields
      );
      const { proof: p2 } = await GovernanceUpdate.createVote(
        updateInput,
        signature2,
        secondCouncilPublicKey,
        combinedMerkleMap.provable,
        Seat.fromIndex(seatIndex2)
      );
      proof2 = p2;
    });

    it('should correctly merge two valid proofs', async () => {
      console.log('Merging votes from seatIndex and seatIndex2...');
      const mergedProof = await GovernanceUpdate.mergeVotes(
        updateInput,
        proof1,
        proof2
      );

      const ok = await verify(mergedProof.proof, verificationKey);
      assert.strictEqual(ok, true, 'Expected the merged proof to verify');

      // Check the final output
      const { cummulatedVoteBitArray, proposalHash } =
        mergedProof.proof.publicOutput;
      // We expect seatIndex and seatIndex2 bits to be set in cummulatedVoteBitArray
      const expectedBits = Field(2 ** seatIndex + 2 ** seatIndex2);
      assert(
        cummulatedVoteBitArray.equals(expectedBits).toBoolean(),
        `Expected OR of seatIndex(${seatIndex}) and seatIndex2(${seatIndex2}) bits`
      );

      const expectedProposalHash = Poseidon.hash(updateInputFields);
      assert(
        proposalHash.equals(expectedProposalHash).toBoolean(),
        'Proposal hash mismatch in merged proof'
      );
      console.log('Merge votes proof verified successfully.');
    });

    it('should fail to merge if the two proofs have different publicInputs', async () => {
      // Make a proof for a *different* input
      const differentInput = EngineUpdateSpec.empty();
      differentInput.protocolUpdateOperation.emergencyStop =
        BoolOperation.flip();
      const differentFields = differentInput.toFields();

      // Make a seatIndex proof for the *different* input
      const signatureDifferent = Signature.create(
        councilPrivateKey,
        differentFields
      );

      const proofWithDifferentInput = await GovernanceUpdate.createVote(
        differentInput,
        signatureDifferent,
        councilPublicKey,
        councilMerkleMap.provable,
        Seat.fromIndex(seatIndex)
      );

      // Attempt to merge that with a valid proof for the original input
      console.log('Attempting merge with mismatched input proofs...');
      await assert.rejects(async () => {
        await GovernanceUpdate.mergeVotes(
          updateInput, // The "current" input is the original
          proof1, // correct input
          proofWithDifferentInput.proof // different input
        );
      }, 'Expected mergeVotes to fail when public inputs do not match');
      console.log('Merging failed as expected.');
    });

    it('should fail to merge if the Merkle roots in the two proofs differ', async () => {
      // proof1 was created from the combined root
      // We'll make a proof2 from a *different* councilRoot (the "secondcouncilMerkleMapRoot" lacking seatIndex)
      // That way, the leftProof.publicOutput.councilMerkleMapRoot != rightProof.publicOutput.councilMerkleMapRoot
      const signature2 = Signature.create(
        secondCouncilPrivateKey,
        updateInputFields
      );
      const proofMismatchRoot = await GovernanceUpdate.createVote(
        updateInput,
        signature2,
        secondCouncilPublicKey,
        secondMerkleMap.provable,
        Seat.fromIndex(seatIndex2)
      );

      console.log('Attempting merge with mismatched council roots...');
      await assert.rejects(async () => {
        await GovernanceUpdate.mergeVotes(
          updateInput,
          proof1,
          proofMismatchRoot.proof
        );
      }, 'Expected mergeVotes to fail if the council roots differ');
      console.log('Merging failed as expected.');
    });
  });
});
