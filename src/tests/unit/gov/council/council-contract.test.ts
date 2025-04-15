import { AccountUpdate, Field, MerkleMap, MerkleTree, Poseidon, Signature } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { TestHelper } from '../../../test-helper.js';
import { KeyPair } from '../../../../types/utility.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
import {
  MultiSigZkusdProtocolUpdateProgram,
  ZkusdCouncilMemberWitness,
  ZkusdGoverningCouncilVoteProof,
} from '../../../../proofs/gov/council-multisig.js';
import {
  ZKUSD_GOV_UPDATE_TREE_HEIGHT,
  ZkusdGovUpdateWitness,
} from '../../../../system/governance.js';
import { countBits } from '../../../../contracts/zkusd-government-poc.js';

async function prepareCouncilMembers(th: TestHelper<'local'>) {
  if (
    th.networkKeys.council === undefined ||
    th.networkKeys.council.length === 0
  ) {
    throw new Error('Council keys are not defined');
  }
  return th.networkKeys.council;
}

async function generateVoteProof(
  councilMember: KeyPair,
  councilTree: MerkleTree,
  seatIndex: number
): Promise<ZkusdGoverningCouncilVoteProof> {
  // an example of a update - an empty one, but its okay for these tests.
  const updateInput = ZkusdProtocolUpdateSpec.empty();
  const updateInputFields = updateInput.toFields();
  const signature = Signature.create(
    councilMember.privateKey,
    updateInputFields
  );

  const witness = new ZkusdCouncilMemberWitness(
    councilTree.getWitness(BigInt(seatIndex))
  );

  console.log('Creating vote (correct signature, correct membership)...');
  const { proof } = await MultiSigZkusdProtocolUpdateProgram.createVote(
    updateInput,
    signature,
    councilMember.publicKey,
    witness,
    councilTree.getRoot(),
    Field(2 ** seatIndex) // The seat index is encoded as 2^index
  );
  return proof;
}

describe('zkUSD Multisig Council Test Suite', () => {
  let testHelper: TestHelper<'local'>;
  let council: KeyPair[];
  let proposalMerkleMap = new MerkleMap();
  let resolutionMerkleTree = new MerkleTree(ZKUSD_GOV_UPDATE_TREE_HEIGHT);
  let proposalSpec: ZkusdProtocolUpdateSpec;
  let councilMerkleTree: MerkleTree;

  before(async () => {
    // Initialize test environment
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();

    await testHelper.createLocalAgents('alice');

    council = await prepareCouncilMembers(testHelper);

    councilMerkleTree =
      testHelper.council.buildAndVerifyCouncilMerkleTree(
        council.map((keypair) => keypair.publicKey)
      );
  });

  it('should be able to build a merkle tree that matches the merkle root', async () => {

    console.log(councilMerkleTree.getRoot().toString());

    const councilContractRoot =
      await testHelper.council.councilMembersMerkleRoot.fetch();
    if (!councilContractRoot) {
      throw new Error('Council contract root is undefined');
    }

    assert.ok(
      councilMerkleTree.getRoot().equals(councilContractRoot),
      'Merkle root does not match'
    );
  });

  it('should be possible for a council member to create a proposal', async () => {
    const councilMerkleTree =
      testHelper.council.buildAndVerifyCouncilMerkleTree(
        council.map((keypair) => keypair.publicKey)
      );

    const councilSeatIndex = 0;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleTree,
      councilSeatIndex
    );
    proposalSpec = voteProof.publicInput;

    const { proposalWitness, proposalCurrentVoteBitArray, resolutionWitness } =
      supportProposalHelper(voteProof, proposalMerkleMap, resolutionMerkleTree);
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.supportProposal(
          voteProof,
          proposalWitness,
          proposalCurrentVoteBitArray,
          resolutionWitness
        );
      },
      { name: 'Council member casts a single vote proof' }
    );

    // verify if the vote was registered for the proposal.
    const [newRoot] = proposalWitness.computeRootAndKey(voteBitArray);
    // ensure that the root is set to this
    const actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(newRoot.equals(actualRoot), 'Proposal root does not match');
    // update the tree to match the root
    proposalMerkleMap.set(voteProof.publicOutput.proposalHash, voteBitArray)
  });

  it('should not be possible to pass a proposal with unsufficient amount of votes', async () => {
    const actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }

    const proposalHash = Poseidon.hash(proposalSpec.toFields());
    const proposalWitness = proposalMerkleMap.getWitness(proposalHash);
    const proposalCurrentVoteBitArray = proposalMerkleMap.get(proposalHash);
    const resolutionWitness = new ZkusdGovUpdateWitness(resolutionMerkleTree.getWitness(proposalSpec.govResolutionIndex.toBigint()));

    const voteThreshold = await testHelper.council.standardProposalPassThreshold.fetch()

    voteThreshold?.assertGreaterThan(countBits(proposalCurrentVoteBitArray));

    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.council.passProposal(proposalSpec, proposalWitness, proposalCurrentVoteBitArray, resolutionWitness)
        },
        { name: 'Alice tries to pass a proposal without it passing the threshold of votes.' }
      );
    });
  });

  it('should not be possible to add a second vote using the same seat', async () => {

    const councilSeatIndex = 0;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    const proposalCurrentVoteBitArray = proposalMerkleMap.get(Poseidon.hash(proposalSpec.toFields()));
    const expectedRoot = proposalMerkleMap.getRoot();

    let actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(expectedRoot.equals(actualRoot), 'Proposal root does not match');

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleTree,
      councilSeatIndex
    );
    proposalSpec = voteProof.publicInput;

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.supportProposalHelper(
          voteProof,
          proposalMerkleMap,
          resolutionMerkleTree
        );
      },
      { name: 'Same seat casts another vote' }
    );

    actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(expectedRoot.equals(actualRoot), 'Proposal root does not match');

  });

  it('should be possible add a vote to an existing proposal and then pass it', async () => {

    const proposalHash = Poseidon.hash(proposalSpec.toFields());
    const councilSeatIndex = 1;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    const proposalCurrentVoteBitArray = proposalMerkleMap.get(proposalHash);
    const newVoteBitArrayValue = proposalCurrentVoteBitArray.add(voteBitArray);
    const expectedRoot = proposalMerkleMap.getRoot();

    let actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(expectedRoot.equals(actualRoot), 'Proposal root does not match');

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleTree,
      councilSeatIndex
    );

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.supportProposalHelper(
          voteProof,
          proposalMerkleMap,
          resolutionMerkleTree
        );
      },
      { name: 'Another Seat cast a vote' }
    );

    const proposalWitness = proposalMerkleMap.getWitness(proposalHash);

    const [newRoot] = proposalWitness.computeRootAndKey(newVoteBitArrayValue);

    actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(newRoot.equals(actualRoot), 'Proposal root does not match');

    proposalMerkleMap.set(proposalHash, newVoteBitArrayValue);

    // new vote is now casted let's retry passing the proposal
    const newproposalWitness = proposalMerkleMap.getWitness(proposalHash);
    const resolutionWitness = new ZkusdGovUpdateWitness(resolutionMerkleTree.getWitness(proposalSpec.govResolutionIndex.toBigint()));

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.passProposal(proposalSpec, newproposalWitness, newVoteBitArrayValue, resolutionWitness)
      },
      { name: 'Alice tries to pass a proposal with sufficient votes' }
    );

    const actualResolutionRoot = await testHelper.council.resolutionsMerkleRoot.fetch();
    if(!actualResolutionRoot){
      throw "Could not fetch resolution merkle root"
    }
    const expectedResolutionRoot = resolutionWitness.calculateRoot(proposalHash);

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot));

    resolutionMerkleTree.setLeaf(proposalSpec.govResolutionIndex.toBigint(), proposalHash);
  });

  // it('should initialize the council allow the gov admin to stop the protocol', async () => {
  //   // Confirm the protocol is currently running
  //   await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
  //     force: true,
  //   });
  //   let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //   assert.equal(isStopped, false, 'Protocol should initially be running');

  //   // Prepare inputs and proof to toggle the emergency stop
  //   const updateInput = toggleEmergencyStop();
  //   const { sideLoadedProof, verificationKey, witness } =
  //     await createAdminSigProof(updateInput);

  //   // Execute transaction to stop the protocol
  //   await testHelper.includeTx(
  //     testHelper.agents.alice.keys,
  //     async () => {
  //       await testHelper.engine.contract.govToggleEmergencyStop(
  //         verificationKey,
  //         witness,
  //         sideLoadedProof
  //       );
  //     },
  //     { name: 'Alice stops protocol using an admin signature update' }
  //   );

  //   // Verify the protocol is now stopped
  //   await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
  //     force: true,
  //   });
  //   isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //   assert.equal(isStopped, true, 'Protocol should now be stopped');
  // });

  // it('should not allow the gov admin to start the protocol with stop proof', async () => {
  //   // Confirm the protocol is currently stopped
  //   await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
  //     force: true,
  //   });
  //   let isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //   assert.equal(isStopped, true, 'Protocol should be stopped');

  //   // now we can create the proof of admin signature
  //   const updateInput = updateProtocolEmergencyStop({
  //     emergencyStopOperation: BoolOperation.mkFlip(),
  //     protocolPreconditions: ZkusdProtocolPreconditions.create({
  //       emergencyStop: BoolPrecondition.mkMustEqual(false), // it requires the protocol to be running, but it's not
  //     }),
  //   });

  //   const { sideLoadedProof, verificationKey, witness } =
  //     await createAdminSigProof(updateInput);

  //   // This transaction should fail because the precondition contradicts reality
  //   await assert.rejects(async () => {
  //     await testHelper.includeTx(
  //       testHelper.agents.alice.keys,
  //       async () => {
  //         await testHelper.engine.contract.govToggleEmergencyStop(
  //           verificationKey,
  //           witness,
  //           sideLoadedProof
  //         );
  //       },
  //       {
  //         name: 'Alice attempts to start protocol with an invalid proof precondition',
  //       }
  //     );
  //   }, 'Expected transaction to fail but it succeeded.');

  //   // Verify the protocol remains stopped
  //   await testHelper.mina.fetchMinaAccount(testHelper.engine.contract.address, {
  //     force: true,
  //   });
  //   isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //   assert.equal(isStopped, true, 'Protocol should still be stopped');
  // });
  // describe('Blockchain Length Precondition Tests (Bob)', () => {
  //   // Suppose we require the chain length to be >= 1010 to start
  //   const requiredChainLength = 1010;

  //   it("Bob can't start the protocol if the blockchain length is below the required threshold", async () => {
  //     // Confirm the protocol is still stopped from previous tests
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     let isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should currently be stopped');

  //     // Create an update input that tries to start the protocol (set emergencyStop = false)
  //     // but also requires the current blockchain length to be >= requiredChainLength
  //     const updateInput = updateProtocolEmergencyStop({
  //       // these fields might differ based on your updateProtocolEmergencyStop signature
  //       blockchainPreconditions: MinaChainPreconditions.blockchainLength(
  //         UInt32.from(requiredChainLength),
  //         UInt32.from(2000)
  //       ),
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       protocolPreconditions: ZkusdProtocolPreconditions.create({
  //         // Protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BoolPrecondition.mkMustEqual(true),
  //       }),
  //     });

  //     // Create the proof signed by the actual protocol admin
  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Bob includes the transaction, but if the blockchain length is < requiredChainLength,
  //     // the transaction should fail due to the unmet precondition
  //     await assert.rejects(async () => {
  //       await testHelper.includeTx(
  //         testHelper.agents.bob.keys, // Bob is the sender
  //         async () => {
  //           await testHelper.engine.contract.govToggleEmergencyStop(
  //             verificationKey,
  //             witness,
  //             sideLoadedProof
  //           );
  //         },
  //         {
  //           name: "Bob attempts to start protocol but blockchain length hasn't reached the threshold",
  //         }
  //       );
  //     }, 'Expected transaction to fail but it succeeded.');

  //     // The protocol should remain stopped
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should remain stopped');
  //   });

  //   it('Bob can start the protocol once the blockchain length threshold is reached', async () => {
  //     // Move the chain forward until we satisfy the required length (from previous test).
  //     // If we started at 1000, and need 1010, move 10 blocks forward:
  //     await testHelper.mina.moveChainForward(10);

  //     // The same updateInput from the previous test can be reused,
  //     // or you can recreate it for clarity:
  //     const updateInput = updateProtocolEmergencyStop({
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       blockchainPreconditions: MinaChainPreconditions.blockchainLength(
  //         UInt32.from(requiredChainLength),
  //         UInt32.from(2000)
  //       ),
  //       protocolPreconditions: ZkusdProtocolPreconditions.create({
  //         // protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BoolPrecondition.mkMustEqual(true),
  //         // blockchainLength: NumericPrecondition.mkMustBeGreaterOrEqual(1010),
  //       }),
  //     });

  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Now the chain length should be >= 1010, so the transaction ought to succeed
  //     await testHelper.includeTx(
  //       testHelper.agents.bob.keys,
  //       async () => {
  //         await testHelper.engine.contract.govToggleEmergencyStop(
  //           verificationKey,
  //           witness,
  //           sideLoadedProof
  //         );
  //       },
  //       {
  //         name: 'Bob successfully starts protocol after blockchain length threshold is met',
  //       }
  //     );

  //     // Verify the protocol is now running
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     const isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, false, 'Protocol should now be running');
  //   });
  // });
  // ========================================================================
  // CURRENT SLOT IS ALWAYS 0 IN LOCAL TESTS
  // ========================================================================
  //
  // New Tests for Bob and Block Slot Preconditions
  //
  // describe('Block Slot Precondition Tests (Bob)', () => {
  //   it("Bob can't start the protocol if the block slot is below the required threshold", async () => {
  //     // Confirm the protocol is still stopped from previous tests
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     let isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should currently be stopped');

  //     // Suppose we require the chain slot to be >= 10 to start
  //     const requiredSlot = 10;

  //     // Create an update input that tries to start the protocol (set emergencyStop = false)
  //     // but also requires the current block slot to be >= requiredSlot
  //     const updateInput = updateProtocolEmergencyStop({
  //       firstSlotIndex: requiredSlot,
  //       lastSlotIndex: 1000,
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       protocolPreconditions: ZkusdProtocolPreconditions.create({
  //         // protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BoolPrecondition.mkMustEqual(true),
  //         // This numeric precondition is hypothetical; adapt to your code if needed
  //         // blockSlot: NumericPrecondition.mkMustBeGreaterOrEqual(requiredSlot),
  //       }),
  //     });

  //     // Create the proof signed by the actual protocol admin
  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Bob includes the transaction, but if the chain slot is < requiredSlot,
  //     // the transaction should fail due to unmet precondition
  //     await assert.rejects(async () => {
  //       await testHelper.includeTx(
  //         testHelper.agents.bob.keys, // Bob is the sender
  //         async () => {
  //           await testHelper.engine.contract.govStopProtocol(
  //             verificationKey,
  //             witness,
  //             sideLoadedProof
  //           );
  //         },
  //         {
  //           name: "Bob attempts to start protocol but block slot hasn't reached the threshold",
  //         }
  //       );
  //     }, 'Expected transaction to fail but it succeeded.');

  //     // The protocol should remain stopped
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     isStopped = testHelper.engine.contract.isEmergencyStopped().toBoolean();
  //     assert.equal(isStopped, true, 'Protocol should remain stopped');
  //   });

  //   it('Bob can start the protocol once the block slot threshold is reached', async () => {
  //     // Move the chain forward until we satisfy the required slot (from previous test)
  //     // Increase this number if you know your current slot.
  //     await testHelper.mina.moveChainForward(10);

  //     // The same updateInput from the previous test can be reused,
  //     // or you can recreate it for clarity:
  //     const updateInput = updateProtocolEmergencyStop({
  //       emergencyStopOperation: BoolOperation.mkSetTo(Bool(false)),
  //       firstSlotIndex: 10,
  //       lastSlotIndex: 1000,
  //       protocolPreconditions: ZkusdProtocolPreconditions.create({
  //         // protocol is currently stopped => mustEqual(true)
  //         emergencyStop: BoolPrecondition.mkMustEqual(true),
  //       }),
  //     });

  //     const { sideLoadedProof, verificationKey, witness } =
  //       await createAdminSigProof(updateInput);

  //     // Now the chain slot should be >= 10, so the transaction ought to succeed
  //     await testHelper.includeTx(
  //       testHelper.agents.bob.keys,
  //       async () => {
  //         await testHelper.engine.contract.govStopProtocol(
  //           verificationKey,
  //           witness,
  //           sideLoadedProof
  //         );
  //       },
  //       {
  //         name: 'Bob successfully starts protocol after slot threshold is met',
  //       }
  //     );

  //     // Verify the protocol is now running
  //     await testHelper.mina.fetchMinaAccount(
  //       testHelper.engine.contract.address,
  //       { force: true }
  //     );
  //     const isStopped = testHelper.engine.contract
  //       .isEmergencyStopped()
  //       .toBoolean();
  //     assert.equal(isStopped, false, 'Protocol should now be running');
  //   });
  // });
});

function supportProposalHelper(
  voteProof: ZkusdGoverningCouncilVoteProof,
  proposalTree: MerkleMap,
  resolutionTree: MerkleTree
) {
  const proposalWitness = proposalTree.getWitness(
    voteProof.publicOutput.proposalHash
  );
  const resolutionWitness = new ZkusdGovUpdateWitness(
    resolutionTree.getWitness(
      voteProof.publicInput.govResolutionIndex.toBigint()
    )
  );
  const proposalCurrentVoteBitArray = proposalTree.get(
    voteProof.publicOutput.proposalHash
  );
  return {
    proposalWitness,
    proposalCurrentVoteBitArray,
    resolutionWitness,
  };
}
