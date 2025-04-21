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

import {
  MultiSigZkusdProtocolUpdateProgram,
  ZKUSD_COUNCIL_TREE_HEIGHT,
  ZkusdCouncilMemberWitness,
  pubkeyToCouncilSeatLeaf,
} from '../../../../proofs/gov/council-multisig.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
import { BoolOperation } from '../../../../system/update/simple-operations.js';
import { ZkusdProtocolUpdateOutput } from '../../../../system/update/output.js';


// A small helper for building and proving membership in a Merkle tree
class CouncilMerkleTree {
  height: number;
  tree: MerkleTree;
  constructor(height: number) {
    this.height = height;
    this.tree = new MerkleTree(height);
    // Pre-fill tree with zero leaves
  }

  setMember(index: number, pubKey: PublicKey) {
    // For the seat index i, we store Poseidon([2^i, ...pubKey.toFields()])
    const leaf = pubkeyToCouncilSeatLeaf(pubKey, index);
    this.tree.setLeaf(BigInt(index), leaf);
  }

  getRoot(): Field {
    return this.tree.getRoot();
  }

  getWitness(index: number): ZkusdCouncilMemberWitness {
    return new ZkusdCouncilMemberWitness(this.tree.getWitness(BigInt(index)));
  }
}

describe('MultiSigZkusdProtocolUpdateProgram', () => {
  let verificationKey: VerificationKey;
  let councilMerkleRoot: Field;
  let councilTree: CouncilMerkleTree;
  let seatIndex = 3; // Example seat index

  let councilPrivateKey: PrivateKey;
  let councilPublicKey: PublicKey;
  let wrongPrivateKey: PrivateKey;
  let wrongPublicKey: PublicKey;

  // A shared sample input for all tests
  let updateInput: ZkusdProtocolUpdateSpec;
  let updateInputFields: Field[];

  before(async () => {
    console.log('Compiling ZkProgram...');
    const { verificationKey: vk } = await MultiSigZkusdProtocolUpdateProgram.compile();
    verificationKey = vk;
    console.log('Compilation complete.');

    // Prepare a sample update spec
    updateInput = ZkusdProtocolUpdateSpec.empty();
    updateInputFields = updateInput.toFields();

    // Create keys
    councilPrivateKey = PrivateKey.random();
    councilPublicKey = councilPrivateKey.toPublicKey();

    wrongPrivateKey = PrivateKey.random();
    wrongPublicKey = wrongPrivateKey.toPublicKey();

    // Build a Merkle tree for the council
    councilTree = new CouncilMerkleTree(ZKUSD_COUNCIL_TREE_HEIGHT);
    councilTree.setMember(seatIndex, councilPublicKey);
    councilMerkleRoot = councilTree.getRoot();
  });

  // ------------------------------------------------------------
  // createVote Tests
  // ------------------------------------------------------------
  describe('createVote()', () => {
    it('should produce a valid proof with correct signature and Merkle membership', async () => {
      // 1. Sign the correct input data
      const signature = Signature.create(councilPrivateKey, updateInputFields);

      // 2. Get the Merkle witness for seatIndex
      const witness = councilTree.getWitness(seatIndex);

      // 3. Generate proof
      console.log('Creating vote (correct signature, correct membership)...');
      const { proof } = await MultiSigZkusdProtocolUpdateProgram.createVote(
        updateInput,
        signature,
        councilPublicKey,
        witness,
        councilMerkleRoot,
        Field(2 ** seatIndex) // The seat index is encoded as 2^index
      );
      console.log('Proof created.');

      // 4. Verify proof
      const ok = await verify(proof, verificationKey);
      assert.strictEqual(ok, true, 'Expected valid proof to verify successfully');

      // 5. Check publicOutput
      const { proposalHash, councilMemberMerkleRoot, cummulatedVoteBitArray } = proof.publicOutput;
      assert(proposalHash.equals(Poseidon.hash(updateInputFields)).toBoolean(), 'Proposal hash mismatch');
      assert(councilMemberMerkleRoot.equals(councilMerkleRoot).toBoolean(), 'Merkle root mismatch');
      assert(cummulatedVoteBitArray.equals(Field(2 ** seatIndex)).toBoolean(), 'Vote bit array mismatch');
    });

    it('should fail if the signature is for different data', async () => {
      // 1. Create a *different* input
      const differentInput = ZkusdProtocolUpdateSpec.empty();
      // Modify it in some minimal way...
      differentInput.protocolUpdateOperation.emergencyStop = BoolOperation.flip();

      const differentFields = differentInput.toFields();

      // 2. Sign the *different* data
      const wrongSignature = Signature.create(councilPrivateKey, differentFields);

      // 3. Attempt to create a vote proof with the *original* updateInput but the wrong signature
      const witness = councilTree.getWitness(seatIndex);

      console.log('Creating vote with mismatched input-signature...');
      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.createVote(
            updateInput,
            wrongSignature,
            councilPublicKey,
            witness,
            councilMerkleRoot,
            Field(2 ** seatIndex)
          );
        },
        'Expected createVote to fail with incorrect signature'
      );
      console.log('Proof creation failed as expected.');
    });

    it('should fail if the public key is not in the Merkle tree (wrong seat index or witness)', async () => {
      // 1. Sign the correct data
      const signature = Signature.create(councilPrivateKey, updateInputFields);

      // 2. Provide a *wrong* seat index or a wrong witness. E.g. seatIndex+1
      const wrongSeatIndex = seatIndex + 1;
      const witness = councilTree.getWitness(wrongSeatIndex); // Actually won't match the correct key

      console.log('Creating vote with a mismatched seat witness...');
      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.createVote(
            updateInput,
            signature,
            councilPublicKey,
            witness,
            councilMerkleRoot,
            Field(2 ** wrongSeatIndex)
          );
        },
        'Expected createVote to fail if membership proof does not match actual seat'
      );
      console.log('Proof creation failed as expected.');
    });

    it('should fail if we use a completely different public key (not in tree)', async () => {
      // 1. Sign the correct data
      const signature = Signature.create(wrongPrivateKey, updateInputFields);

      // 2. Provide the correct seat witness for the *real* public key but try the wrong pubKey
      const witness = councilTree.getWitness(seatIndex);

      console.log('Creating vote with the wrong public key...');
      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.createVote(
            updateInput,
            signature,
            wrongPublicKey,
            witness,
            councilMerkleRoot,
            Field(2 ** seatIndex)
          );
        },
        'Expected createVote to fail if the provided public key is not actually in the tree'
      );
      console.log('Proof creation failed as expected.');
    });
  });

  describe('createVote() - malicious multi-bit index test', () => {
    it('should fail if seat index is not a single bit (e.g., 2^3 + 2^5)', async () => {
      const seatIndexMaliciousValue = Field((1 << 3) + (1 << 5)); // 8 + 32 = 40

      // Suppose we have everything else set up: valid privateKey & signature data
      const privateKey = PrivateKey.random();
      const publicKey = privateKey.toPublicKey();

      // ...some valid updateInput, its fields, and a witness that claims seat=40
      // For brevity, assume you build the tree and witness for a seat=40
      // but in reality, your circuit expects seat=3 or seat=5, not BOTH.
      const signature = Signature.create(privateKey, updateInputFields);
      const witness = councilTree.getWitness(40);  // (If 40 is in range of your tree size)

      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.createVote(
            updateInput,
            signature,
            publicKey,
            witness,
            councilMerkleRoot,
            seatIndexMaliciousValue
          );
        },
        'Expected createVote to fail if the seat index sets multiple bits.'
      );
    });
  });

  // ------------------------------------------------------------
  // mergeVotes Tests
  // ------------------------------------------------------------
  describe('mergeVotes()', () => {
    let seatIndex2 = 5; // second seat
    let secondCouncilPrivateKey: PrivateKey;
    let secondCouncilPublicKey: PublicKey;

    let secondTree: CouncilMerkleTree;
    let secondCouncilMerkleRoot: Field;

    let proof1: Proof<ZkusdProtocolUpdateSpec, ZkusdProtocolUpdateOutput>;
    let proof2: Proof<ZkusdProtocolUpdateSpec, ZkusdProtocolUpdateOutput>;

    before(async () => {
      // Build a second tree that also has seatIndex2
      secondCouncilPrivateKey = PrivateKey.random();
      secondCouncilPublicKey = secondCouncilPrivateKey.toPublicKey();

      secondTree = new CouncilMerkleTree(ZKUSD_COUNCIL_TREE_HEIGHT);
      secondTree.setMember(seatIndex2, secondCouncilPublicKey);
      secondCouncilMerkleRoot = secondTree.getRoot();

      // For the merge to pass, *both* proofs must have the SAME publicInput & the SAME councilMemberMerkleRoot
      // So let's unify them by building a single tree that has both seats:
      // seatIndex -> councilPublicKey
      // seatIndex2 -> secondCouncilPublicKey

      // That can be done easily by building one combined tree:
      const combinedTree = new CouncilMerkleTree(ZKUSD_COUNCIL_TREE_HEIGHT);
      combinedTree.setMember(seatIndex, councilPublicKey);
      combinedTree.setMember(seatIndex2, secondCouncilPublicKey);
      const combinedRoot = combinedTree.getRoot();

      // Now generate two separate proofs with the same root, same public input, but different seats.

      // First proof
      const signature1 = Signature.create(councilPrivateKey, updateInputFields);
      const witness1 = combinedTree.getWitness(seatIndex);
      const { proof: p1 } = await MultiSigZkusdProtocolUpdateProgram.createVote(
        updateInput,
        signature1,
        councilPublicKey,
        witness1,
        combinedRoot,
        Field(2 ** seatIndex)
      );
      proof1 = p1;

      // Second proof
      const signature2 = Signature.create(secondCouncilPrivateKey, updateInputFields);
      const witness2 = combinedTree.getWitness(seatIndex2);
      const { proof: p2 } = await MultiSigZkusdProtocolUpdateProgram.createVote(
        updateInput,
        signature2,
        secondCouncilPublicKey,
        witness2,
        combinedRoot,
        Field(2 ** seatIndex2)
      );
      proof2 = p2;
    });

    it('should correctly merge two valid proofs', async () => {
      console.log('Merging votes from seatIndex and seatIndex2...');
      const mergedProof = await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
        updateInput,
        proof1,
        proof2
      );

      const ok = await verify(mergedProof.proof, verificationKey);
      assert.strictEqual(ok, true, 'Expected the merged proof to verify');

      // Check the final output
      const { cummulatedVoteBitArray, proposalHash } = mergedProof.proof.publicOutput;
      // We expect seatIndex and seatIndex2 bits to be set in cummulatedVoteBitArray
      const expectedBits = Field((2 ** seatIndex) + (2 ** seatIndex2));
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
      const differentInput = ZkusdProtocolUpdateSpec.empty();
      differentInput.protocolUpdateOperation.emergencyStop = BoolOperation.flip();
      const differentFields = differentInput.toFields();

      // Make a seatIndex proof for the *different* input
      const signatureDifferent = Signature.create(councilPrivateKey, differentFields);
      const witness1 = councilTree.getWitness(seatIndex);

      const proofWithDifferentInput = await MultiSigZkusdProtocolUpdateProgram.createVote(
        differentInput,
        signatureDifferent,
        councilPublicKey,
        witness1,
        councilMerkleRoot,
        Field(2 ** seatIndex)
      );

      // Attempt to merge that with a valid proof for the original input
      console.log('Attempting merge with mismatched input proofs...');
      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
            updateInput, // The "current" input is the original
            proof1,      // correct input
            proofWithDifferentInput.proof // different input
          );
        },
        'Expected mergeVotes to fail when public inputs do not match'
      );
      console.log('Merging failed as expected.');
    });

    it('should fail to merge if the Merkle roots in the two proofs differ', async () => {
      // proof1 was created from the combined root
      // We'll make a proof2 from a *different* councilRoot (the "secondCouncilMerkleRoot" lacking seatIndex)
      // That way, the leftProof.publicOutput.councilMemberMerkleRoot != rightProof.publicOutput.councilMemberMerkleRoot
      const signature2 = Signature.create(secondCouncilPrivateKey, updateInputFields);
      const witness2 = secondTree.getWitness(seatIndex2);
      const proofMismatchRoot = await MultiSigZkusdProtocolUpdateProgram.createVote(
        updateInput,
        signature2,
        secondCouncilPublicKey,
        witness2,
        secondCouncilMerkleRoot,
        Field(2 ** seatIndex2)
      );

      console.log('Attempting merge with mismatched council roots...');
      await assert.rejects(
        async () => {
          await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
            updateInput,
            proof1,
            proofMismatchRoot.proof
          );
        },
        'Expected mergeVotes to fail if the council roots differ'
      );
      console.log('Merging failed as expected.');
    });
  });
});
