import {
  Field,
  Poseidon,
  Signature,
  UInt32,
} from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { TestHelper } from '../../../test-helper.js';
import { KeyPair } from '../../../../types/utility.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
import { ResolutionTree } from '../../../../system/council/resolution-tree.js';
import { ProposalMap } from '../../../../system/council/proposal-merkle-map.js';
import { CouncilProposalPassedEvent, CouncilProposalSupportChangeEvent } from '../../../../system/council/events.js';

describe('zkUSD Multisig Council Test Suite', () => {
  let testHelper: TestHelper<'local'>;
  let updateSpec: ZkusdProtocolUpdateSpec;

  let seat0: KeyPair;
  let seat1: KeyPair;
  let cclient = () => testHelper.councilClient;
  let councilTree = async() => cclient().trees.councilTree.get();
  let proposalMap = async() => cclient().trees.proposalMap.get();
  let resolutionTree = async() => cclient().trees.resolutionTree.get();

  before(async () => {
    // Initialize test environment
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();
    await testHelper.createLocalAgents('alice');
    seat0 = testHelper.networkKeys.council![0];
    seat1 = testHelper.networkKeys.council![1];
  });

  it('client gets a tree matching its onchain root', async () => {

    const tree = await councilTree();
    const contractRoot = await testHelper.councilClient.councilContract.councilMembersMerkleRoot.fetch();

    if (!contractRoot) {
      throw new Error('Contract root is undefined');
    }
    const treeRoot = tree.getRoot();

    assert.ok(
      contractRoot.equals(treeRoot).toBoolean(),
      'Tree root does not match contract root'
    );
  });

  it('should be possible for a council member to create a proposal', async () => {

    updateSpec = ZkusdProtocolUpdateSpec.empty();

    const signature = Signature.create(seat0.privateKey, updateSpec.toFields());

    const voteProof = await cclient().createVoteProof({updateSpec, signature, seat: 0});

    const contractEventsBefore = await testHelper.councilClient.councilContract.fetchEvents();

    const result = await cclient().submitVote(voteProof, seat0);

    assert.ok(result.transactionIncluded, 'Transaction was not included');

    const refreshedMap = await proposalMap(); 
    const newRoot = refreshedMap.getRoot();
    // ensure that the root is set to this
    const rootBefore = await testHelper.councilClient.councilContract.proposalsMerkleMapRoot.fetch();
    if (!rootBefore) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      newRoot.equals(rootBefore).toBoolean(),
      'Proposal root does not match'
    );

    const contractEventsAfter = await cclient().councilContract.fetchEvents();

    //length of events should differ by 1
    assert.strictEqual(
      contractEventsAfter.length,
      contractEventsBefore.length + 1
    );

    const lastEvent = contractEventsAfter[0];

    assert.strictEqual(lastEvent.type, 'ProposalSupported');

    const eventData = lastEvent.event
      .data as unknown as CouncilProposalSupportChangeEvent;

    // check if the eventData matches the expected values
    assert.ok(eventData.proposalMapRootBefore.equals(rootBefore).toBoolean());
    assert.ok(eventData.acceptedVoteBitArray.equals(voteProof.publicOutput.cummulatedVoteBitArray).toBoolean());
    assert.ok(
      eventData.updateHash 
        .equals(Poseidon.hash(updateSpec.toFields()))
        .toBoolean()
    );
    assert.ok(
      eventData.resolutionIndex
        .equals(updateSpec.govResolutionIndex)
        .toBoolean()
    );
  });

  it('should not be possible to pass a proposal with unsufficient amount of votes', async () => {
    const actualRoot = (await testHelper.councilClient.trees.proposalMap.get()).getRoot();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }

    const proposalHash = Poseidon.hash(updateSpec.toFields());
    const proposalCurrentVoteBitArray = (await proposalMap()).get(proposalHash);

    const voteThreshold =
      await testHelper.councilClient.councilContract.standardProposalPassThreshold.fetch();

    voteThreshold?.assertGreaterThan(ProposalMap.countBits(proposalCurrentVoteBitArray));

    const contractEventsBefore = await cclient().councilContract.fetchEvents();
    const result = await cclient().tryPassProposal(updateSpec, seat0); 
    assert.ok(!result.transactionIncluded, 'Transaction was included');

    // now lets test the force flag, it should throw 
    assert.rejects(async () => {
      await cclient().tryPassProposal(updateSpec, seat0, { force: true });
    });

    const contractEventsAfter = await testHelper.councilClient.councilContract.fetchEvents();

    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);
  });

  it('should not be possible to add a second vote using the same seat', async () => {
    const councilSeatIndex = 0;
    const councilMember = seat0;

    const newProof = await cclient().createVoteProof({
      updateSpec,
      signature: Signature.create(councilMember.privateKey, updateSpec.toFields()),
      seat: councilSeatIndex,
    });

    const contractEventsBefore = await cclient().councilContract.fetchEvents();
    const result = await cclient().submitVote(newProof, councilMember);
    // should accept the transaction but the vote count does not increase, i.e. it 
    // still misses another vote
    assert.ok(result.transactionIncluded, 'Transaction was not included');
    assert.ok(!result.votesMissing, 'Votes missing');

    // even though the tx is submitted no new event should be emitted as no change 
    // to the root occurred 
    const contractEventsAfter = await cclient().councilContract.fetchEvents();
    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);

    const actualRoot = await cclient().councilContract.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      actualRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );
  });

  it('should be possible add a vote to an existing proposal and then pass it', async () => {
    const voteProof = await cclient().createVoteProof({
      updateSpec,
      signature: Signature.create(seat1.privateKey, updateSpec.toFields()),
      seat: 1,
    });
    const submitResult = await cclient().submitVote(voteProof, seat1);
    assert.ok(submitResult.transactionIncluded, 'Transaction was not included'); 
    assert.ok(!submitResult.votesMissing, 'Votes missing');

    // now lets pass the proposal
    // check the event emission as well
    const contractEventsBefore = await cclient().councilContract.fetchEvents();
    const passResults = await cclient().tryPassProposal(updateSpec, seat0);
    assert.ok(passResults.transactionIncluded, 'Transaction was not included');
    assert.ok(!passResults.votesMissing, 'Votes missing');

    const contractEventsAfter = await cclient().councilContract.fetchEvents();  
    //length of events should differ by 1
    assert.strictEqual(
      contractEventsAfter.length,
      contractEventsBefore.length + 1
    );

    // check the event data
    const lastEvent = contractEventsAfter[0];
    assert.strictEqual(lastEvent.type, 'ProposalPassed');
    const eventData = lastEvent.event
      .data as unknown as CouncilProposalPassedEvent;
    // check if the eventData matches the expected values
    assert.ok(eventData.updateHash.equals(Poseidon.hash(updateSpec.toFields())).toBoolean());
    assert.ok(
      eventData.resolutionIndex
        .equals(updateSpec.govResolutionIndex)
        .toBoolean()
    );  
    // lets check noow if the resolutiuon ws included in the resolution tree
    const resolutionWitness = (await resolutionTree()).getWitnessWrapped(
      updateSpec.govResolutionIndex.toBigint()
    );
    const proposalHash = Poseidon.hash(updateSpec.toFields());
    const actualResolutionRoot = await cclient().councilContract.resolutionsMerkleRoot.fetch();
    if (!actualResolutionRoot) {
      throw 'Could not fetch resolution merkle root';
    }
    const expectedResolutionRoot =
      resolutionWitness.calculateRoot(proposalHash);

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot).toBoolean());
  });

  it('should be possible to rollup votes and pass the proposal using the rollup', async () => {
    // lets create two vote proofs then merge them 
    const voteProof = await cclient().createVoteProof({
      updateSpec,
      signature: Signature.create(seat0.privateKey, updateSpec.toFields()),
      seat: 0,
    }); 
    const anotherVoteProof = await cclient().createVoteProof({
      updateSpec,
      signature: Signature.create(seat1.privateKey, updateSpec.toFields()),
      seat: 1,
    }); 
    const mergedVotesProof = await cclient().mergeVoteProofs(
      voteProof,
      anotherVoteProof
    );  
    const result = await cclient().submitVote(mergedVotesProof, seat0);
    assert.ok(result.transactionIncluded, 'Transaction was not included');
    assert.ok(!result.votesMissing, 'Votes missing');
    
    // lets check if the vote was registered
    const actualRoot = await cclient().councilContract.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    const proposalHash = Poseidon.hash(updateSpec.toFields());
    const proposalWitness = (await proposalMap()).getWitness(proposalHash);
    const onChainVoteBitArray = (await proposalMap()).get(proposalHash);
    const onchainProposalMapRoot = await cclient().councilContract.proposalsMerkleMapRoot.fetch();
    if (!onchainProposalMapRoot) {
      throw new Error('Proposal root is undefined');
    }
    // make sure that witness computes this root
    const [newRoot] = proposalWitness.computeRootAndKey(onChainVoteBitArray);
    assert.ok(
      newRoot.equals(onchainProposalMapRoot).toBoolean(),
      'Proposal root does not match'
    );
    // double check that the rollup had this amount of votes
    const rolledupBitArray = mergedVotesProof.publicOutput.cummulatedVoteBitArray;
    
    //is equal 
    assert.ok(
      rolledupBitArray.equals(onChainVoteBitArray).toBoolean(),
      'Rollup does not match'
    );  
    // saving events
    const contractEventsBefore = await cclient().councilContract.fetchEvents(); 
    const passResult = await cclient().tryPassProposal(updateSpec, seat0);
    assert.ok(passResult.transactionIncluded, 'Transaction was not included');
    const contractEventsAfter = await cclient().councilContract.fetchEvents();
    //length of events should differ by 1
    assert.strictEqual(
      contractEventsAfter.length,
      contractEventsBefore.length + 1
    );  

    // check if proposal is installed in the resolution tree
    const resolutionWitness = (await resolutionTree()).getWitnessWrapped(
      updateSpec
    );
    const onchainResolutionRoot = await cclient().councilContract.resolutionsMerkleRoot.fetch();
    if (!onchainResolutionRoot) {
      throw 'Could not fetch resolution merkle root';
    }
    const expectedResolutionRoot =
      resolutionWitness.calculateRoot(Poseidon.hash(updateSpec.toFields()));

    assert.ok(onchainResolutionRoot.equals(expectedResolutionRoot).toBoolean());

  });

  it('should be possible to rebuild the resolution and proposal tree with gathered events', async () => {
    const events = await cclient().councilContract.fetchEvents();

    const proposalEvents = events.filter(
      (event) => event.type === 'ProposalSupported'
    );
    const resolutionEvents = events.filter(
      (event) => event.type === 'ProposalPassed'
    );

    const proposalMap = new ProposalMap();
    const resolutionTree = new ResolutionTree();

    proposalEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as CouncilProposalSupportChangeEvent;

      const votes = proposalMap.get(eventData.updateHash);
      // since you cannot retract a vote this is fine
      if (eventData.acceptedVoteBitArray.greaterThan(votes).toBoolean()) {
        proposalMap.set(
          eventData.updateHash,
          eventData.acceptedVoteBitArray
        );
      }
    });

    resolutionEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as CouncilProposalPassedEvent;
      resolutionTree.setLeaf(
        eventData.resolutionIndex.toBigint(),
        eventData.updateHash
      );
    });

    const proposalTreeRoot = proposalMap.getRoot();
    const resolutionTreeRoot = resolutionTree.getRoot();

    const actualProposalTreeRoot =
      await cclient().councilContract.proposalsMerkleMapRoot.fetch();
    if (!actualProposalTreeRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      proposalTreeRoot.equals(actualProposalTreeRoot).toBoolean(),
      'Proposal root does not match'
    );

    const actualResolutionTreeRoot =
      await cclient().councilContract.resolutionsMerkleRoot.fetch();

    if (!actualResolutionTreeRoot) {
      throw new Error('Resolution root is undefined');
    }

    assert.ok(
      resolutionTreeRoot.equals(actualResolutionTreeRoot).toBoolean(),
      'Resolution root does not match'
    );
  });

  it('should not be possible to use existing resolution index', async () => {
    const councilSeatIndex = 0;
    const councilMember = seat0;

    const voteProof = await cclient().createVoteProof({
      updateSpec,
      signature: Signature.create(councilMember.privateKey, updateSpec.toFields()),
      seat: councilSeatIndex,
    });

    updateSpec = voteProof.publicInput;

    const contractEventsBefore = await cclient().councilContract.fetchEvents();

    // use client instead with option force
    await assert.rejects(async () => {
      await cclient().submitVote(
        voteProof,  
        seat0,
        { force: true }  
      );
    },
  );

    const contractEventsAfter = await cclient().councilContract.fetchEvents();
    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);
  });

  describe('canExecuteGovResolution()', () => {
    let nameCounter = 0;
    /**
     * Helper that executes the view‑method inside a dry transaction
     * and returns its Bool result.
     */
    async function applyResolution(
      spec: ZkusdProtocolUpdateSpec,
    ): Promise<boolean> {
      const result = await cclient().applyPassedProposalToEngine(
        spec,
        testHelper.agents.alice.keys
      );
      return result.transactionIncluded;
    }

    it('returns *true* for a resolution that actually passed', async () => {
      const res = await applyResolution(
        updateSpec
      );
      assert.ok(res, 'expected execution to be allowed');
    });

    it('rejects when the proposal hash does **not** match the witness', async () => {
      // Same resolution slot, but totally different proposal data → hash mismatch
      const badSpec = ZkusdProtocolUpdateSpec.empty();
      badSpec.govResolutionIndex = updateSpec.govResolutionIndex;
      await assert.rejects(async () => {
        await applyResolution(badSpec);
      });
    });

    it('rejects when the `govResolutionIndex` mismatches the witness', async () => {
      const badSpec = ZkusdProtocolUpdateSpec.empty();
      badSpec.govResolutionIndex = updateSpec.govResolutionIndex.add(
        UInt32.from(1)
      );

      await assert.rejects(async () => {
        await applyResolution(badSpec);
      });
    });
  });
});

describe('countBits helper', () => {
  const vectors: Array<[bigint, number]> = [
    [0n, 0],
    [1n, 1],
    [2n, 1],
    [3n, 2],
    [(1n << 8n) + (1n << 4n) + 1n, 3], // 0b1_0001_0001
    [1n << 128n, 1],
    [1n << 239n, 1], // highest legal bit
    [(1n << 239n) - 1n, 239], // all lower bits set
  ];

  vectors.forEach(([val, want]) => {
    it(`counts popcount(${val.toString()}) = ${want}`, () => {
      const got = ProposalMap.countBits(Field(val)).toBigInt();
      assert.strictEqual(got, BigInt(want));
    });
  });
});
