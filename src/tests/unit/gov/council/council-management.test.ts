import { describe, it, before } from 'node:test';

import { TestHelper } from '../../../test-helper.js';
import { prepareCouncilMembers, rebuildCouncilMerkleMap } from './common.js';
import assert from 'assert';
import { KeyPair } from '../../../../types/utility.js';
import {
  Field,
  Poseidon,
  PrivateKey,
  Proof,
  Signature,
  UInt8,
  VerificationKey,
  verify,
} from 'o1js';
import { ManageCouncil } from '../../../../proofs/council-update/prove.js';
import { CouncilUpdateVoteInput } from '../../../../system/council/update/input.js';
import { CouncilUpdateVoteOutput } from '../../../../system/council/update/output.js';
import { CouncilMap } from '../../../../system/council/data/council-map.js';
import { Seat } from '../../../../system/council/seat.js';

describe('CouncilUpdate', () => {
  let testHelper: TestHelper<'local'>;
  let council: KeyPair[];
  let manageCouncilVk: VerificationKey;
  before(async () => {
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    const compilationData = await ManageCouncil.compile();
    manageCouncilVk = compilationData.verificationKey;
    council = await prepareCouncilMembers(testHelper);
  });

  describe('Local Council Merkle Map Management', () => {
    let localCouncilMap = new CouncilMap();

    before(async () => {
      for (let i = 0; i < council.length; i++) {
        const seatIndex = 2n ** BigInt(i);
        localCouncilMap.insertAtSeat(council[i].publicKey, Seat.fromIndex(seatIndex));
      }
    });

    describe('createVote()', () => {
      it('should let a council member create a vote to add a new council member', async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);

        const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberKey.publicKey]
        );

        const signature = Signature.create(
          council[0].privateKey,
          input.councilManagementSpec.toFields()
        );

        const councilKey = council[0].publicKey;
        const seat = Seat.fromIndex(0);

        const { proof } = await ManageCouncil.createVote(
          input,
          signature,
          councilKey,
          seat
        );

        const ok = await verify(proof, manageCouncilVk);

        assert.strictEqual(ok, true, 'Proof should be valid');

        const { updatedCouncilMap, cummulatedVoteBitArray } =
          proof.publicOutput;

        assert(
          cummulatedVoteBitArray.equals(seat.value),
          'Cummulated vote bit array mismatch'
        );

        updatedCouncilMap.assertIncluded(
          localCouncilMap.getNextEmptySeat().value
        );
      });

      it('should fail if the signature is for different data', async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);
        const differentVoteThreshold = UInt8.from(4);

        const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberKey.publicKey]
        );

        const differentInput =
          CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
            localCouncilMap,
            differentVoteThreshold,
            [newMemberKey.publicKey]
          );

        const differentSignature = Signature.create(
          council[0].privateKey,
          differentInput.councilManagementSpec.toFields()
        );

        const councilKey = council[0].publicKey;
        const seat = Seat.fromIndex(0);

        await assert.rejects(async () => {
          await ManageCouncil.createVote(
            input,
            differentSignature,
            councilKey,
            seat
          );
        }, 'Expected createVote to fail with incorrect signature');
      });

      it('should fail if the public keys is not in the Merkle Map', async () => {
        const badKeyPair = PrivateKey.randomKeypair();

        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);

        const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberKey.publicKey]
        );

        const signature = Signature.create(
          badKeyPair.privateKey,
          input.councilManagementSpec.toFields()
        );

        const councilKey = badKeyPair.publicKey;
        const seat = Seat.fromIndex(0);

        await assert.rejects(async () => {
          await ManageCouncil.createVote(
            input,
            signature,
            councilKey,
            seat
          );
        }, 'Expected createVote to fail with with invalid council member at seat');
      });

      it('should fail if the public key provides the wrong seat index', async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);

        const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberKey.publicKey]
        );

        const signature = Signature.create(
          council[0].privateKey,
          input.councilManagementSpec.toFields()
        );

        const councilKey = council[0].publicKey;
        const seat = Seat.fromIndex(1);

        await assert.rejects(async () => {
          await ManageCouncil.createVote(
            input,
            signature,
            councilKey,
            seat
          );
        }, 'Expected createVote to fail with wrong seat index');
      });
      it('should fail if seat index is not a single bit (e.g., 2^3 + 2^5)', async () => {
        const seatIndexMaliciousValue = 40; // 8 + 32 = 40

        // Suppose we have everything else set up: valid privateKey & signature data
        const newMemberPrivateKey = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);

        const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberPrivateKey.publicKey]
        );

        input.councilManagementSpec.councilManagementActions.actions[0].seat =
          Seat.fromIndex(seatIndexMaliciousValue);

        const signature = Signature.create(
          newMemberPrivateKey.privateKey,
          input.councilManagementSpec.toFields()
        );

        await assert.rejects(async () => {
          await ManageCouncil.createVote(
            input,
            signature,
            newMemberPrivateKey.publicKey,
            Seat.fromIndex(seatIndexMaliciousValue)
          );
        }, 'Expected createVote to fail if the seat index sets multiple bits.');
      });
    });
    describe('mergeVotes()', () => {
      let proof1: Proof<
        CouncilUpdateVoteInput,
        CouncilUpdateVoteOutput
      >;
      let proof2: Proof<
        CouncilUpdateVoteInput,
        CouncilUpdateVoteOutput
      >;
      let input: CouncilUpdateVoteInput;

      before(async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(3);

        input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
          localCouncilMap,
          newVoteThreshold,
          [newMemberKey.publicKey]
        );

        const signature1 = Signature.create(
          council[0].privateKey,
          input.councilManagementSpec.toFields()
        );

        const { proof: p1 } = await ManageCouncil.createVote(
          input,
          signature1,
          council[0].publicKey,
          Seat.fromIndex(0)
        );

        proof1 = p1;

        const signature2 = Signature.create(
          council[1].privateKey,
          input.councilManagementSpec.toFields()
        );

        const { proof: p2 } = await ManageCouncil.createVote(
          input,
          signature2,
          council[1].publicKey,
          Seat.fromIndex(1)
        );

        proof2 = p2;
      });

      it('should merge two votes', async () => {
        const mergedProof = await ManageCouncil.mergeVotes(
          input,
          proof1,
          proof2
        );

        const ok = await verify(mergedProof.proof, manageCouncilVk);

        assert.strictEqual(ok, true, 'Proof should be valid');
      });

      it('should fail to merge two vote proofs with different input', async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(5);

        const differentInput =
          CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
            localCouncilMap,
            newVoteThreshold,
            [newMemberKey.publicKey]
          );

        await assert.rejects(async () => {
          await ManageCouncil.mergeVotes(differentInput, proof1, proof2);
        }, 'Expected mergeVotes to fail with different input');
      });

      it('should fail to merge two vote proofs with different proof', async () => {
        const newMemberKey: KeyPair = PrivateKey.randomKeypair();
        const newVoteThreshold = UInt8.from(5);

        const differentInput =
          CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
            localCouncilMap,
            newVoteThreshold,
            [newMemberKey.publicKey]
          );

        const signature3 = Signature.create(
          council[2].privateKey,
          differentInput.councilManagementSpec.toFields()
        );

        const { proof: p3 } = await ManageCouncil.createVote(
          differentInput,
          signature3,
          council[2].publicKey,
          Seat.fromIndex(2)
        );

        await assert.rejects(async () => {
          await ManageCouncil.mergeVotes(input, proof1, p3);
        }, 'Expected mergeVotes to fail with different proof');
      });
    });
  });

  describe('Council Management on Chain', () => {
    let currentCouncilMap: CouncilMap;
    let currentThreshold: UInt8;

    before(async () => {
      await testHelper.deployTokenContracts();
    });

    it('should initialize the council', async () => {
      const events = await testHelper.council.fetchEvents();
      const councilMerkleMap = rebuildCouncilMerkleMap(events);

      const onChainRoot = await testHelper.council.councilMerkleMapRoot.fetch();

      assert.deepStrictEqual(councilMerkleMap.root, onChainRoot);

      currentCouncilMap = councilMerkleMap;
      currentThreshold =
        (await testHelper.council.votePassThreshold.fetch()) as UInt8;
    });

    it('should be possible to add new council members and change the threshold', async () => {
      const newMemberKey: KeyPair = PrivateKey.randomKeypair();
      const newVoteThreshold = UInt8.from(3);

      const input = CouncilUpdateVoteInput.addMembersAndUpdateThreshold(
        currentCouncilMap,
        newVoteThreshold,
        [newMemberKey.publicKey]
      );

      const signature1 = Signature.create(
        council[0].privateKey,
        input.councilManagementSpec.toFields()
      );

      const { proof: proof1 } = await ManageCouncil.createVote(
        input,
        signature1,
        council[0].publicKey,
        Seat.fromIndex(0)
      );

      const signature2 = Signature.create(
        council[1].privateKey,
        input.councilManagementSpec.toFields()
      );

      const { proof: proof2 } = await ManageCouncil.createVote(
        input,
        signature2,
        council[1].publicKey,
        Seat.fromIndex(1)
      );

      const mergedProof = await ManageCouncil.mergeVotes(input, proof1, proof2);

      //Update the council on chain
      await testHelper.includeTx(testHelper.deployer, async () => {
        await testHelper.council.executeCouncilUpdateActions(
          mergedProof.proof
        );
      });

      const updatedCouncilMap =
        await testHelper.council.councilMerkleMapRoot.fetch();
      assert.deepStrictEqual(
        updatedCouncilMap,
        mergedProof.proof.publicOutput.updatedCouncilMap.root,
        'Updated council map should match the merged proof'
      );

      const updatedThreshold =
        await testHelper.council.votePassThreshold.fetch();
      assert.deepStrictEqual(
        updatedThreshold,
        newVoteThreshold,
        'Updated threshold should match the new vote threshold'
      );
    });
  });
});
