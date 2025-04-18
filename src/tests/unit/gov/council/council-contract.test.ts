import {
  Bool,
  Field,
  MerkleMap,
  MerkleTree,
  Poseidon,
  Provable,
  UInt32,
} from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { TestHelper } from '../../../test-helper.js';
import { KeyPair } from '../../../../types/utility.js';
import { ZkusdProtocolUpdateSpec } from '../../../../system/update/input.js';
import {
  MultiSigZkusdProtocolUpdateProgram,
  ZkusdGoverningCouncilVoteProof,
} from '../../../../proofs/gov/council-multisig.js';
import {
  ZKUSD_GOV_UPDATE_TREE_HEIGHT,
  ZkusdGovUpdateWitness,
} from '../../../../system/governance.js';
import { countBits } from '../../../../contracts/zkusd-governing-council.js';
import {
  CouncilProposalPassedEvent,
  CouncilProposalSupportChangeEvent,
  getNewCouncilMembers,
} from '../../../../system/council-events.js';
import { generateVoteProof, prepareCouncilMembers } from './common.js';

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

    councilMerkleTree = testHelper.council.buildAndVerifyCouncilMerkleTree(
      council.map((keypair) => keypair.publicKey)
    );
  });
  it('should be possible to rebuild council merkle tree from emitted events', async () => {
    const contractEvents = await testHelper.council.fetchEvents();

    const councilKeys = getNewCouncilMembers(contractEvents);

    council.forEach((key) => {
      Provable.log(key);
    });

    councilKeys.forEach((key) => {
      Provable.log(key);
    });
    const councilMerkleTreeFromEvents =
      testHelper.council.buildAndVerifyCouncilMerkleTree(councilKeys);

    assert.ok(
      councilMerkleTreeFromEvents
        .getRoot()
        .equals(councilMerkleTree.getRoot())
        .toBoolean()
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

    const contractEventsBefore = await testHelper.council.fetchEvents();

    const [rootBefore] = proposalWitness.computeRootAndKey(
      proposalCurrentVoteBitArray
    );

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
    assert.ok(
      newRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );
    // update the tree to match the root
    proposalMerkleMap.set(voteProof.publicOutput.proposalHash, voteBitArray);

    const contractEventsAfter = await testHelper.council.fetchEvents();

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
    assert.ok(eventData.proposalTreeRootBefore.equals(rootBefore).toBoolean());
    assert.ok(eventData.acceptedVoteBitArray.equals(voteBitArray).toBoolean());
    assert.ok(
      eventData.proposalHash
        .equals(Poseidon.hash(proposalSpec.toFields()))
        .toBoolean()
    );
    assert.ok(
      eventData.resolutionIndex
        .equals(proposalSpec.govResolutionIndex)
        .toBoolean()
    );
  });

  it('should not be possible to pass a proposal with unsufficient amount of votes', async () => {
    const actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }

    const proposalHash = Poseidon.hash(proposalSpec.toFields());
    const proposalWitness = proposalMerkleMap.getWitness(proposalHash);
    const proposalCurrentVoteBitArray = proposalMerkleMap.get(proposalHash);
    const resolutionWitness = new ZkusdGovUpdateWitness(
      resolutionMerkleTree.getWitness(
        proposalSpec.govResolutionIndex.toBigint()
      )
    );

    const voteThreshold =
      await testHelper.council.standardProposalPassThreshold.fetch();

    voteThreshold?.assertGreaterThan(countBits(proposalCurrentVoteBitArray));

    const contractEventsBefore = await testHelper.council.fetchEvents();
    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.council.passProposal(
            proposalSpec,
            proposalWitness,
            proposalCurrentVoteBitArray,
            resolutionWitness
          );
        },
        {
          name: 'Alice tries to pass a proposal without it passing the threshold of votes.',
        }
      );
    });
    const contractEventsAfter = await testHelper.council.fetchEvents();

    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);
  });

  it('should not be possible to add a second vote using the same seat', async () => {
    const councilSeatIndex = 0;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    const proposalCurrentVoteBitArray = proposalMerkleMap.get(
      Poseidon.hash(proposalSpec.toFields())
    );
    const expectedRoot = proposalMerkleMap.getRoot();

    let actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      expectedRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleTree,
      councilSeatIndex
    );
    proposalSpec = voteProof.publicInput;

    const contractEventsBefore = await testHelper.council.fetchEvents();
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
    const contractEventsAfter = await testHelper.council.fetchEvents();
    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);

    actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      expectedRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );
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
    assert.ok(
      expectedRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );

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
    assert.ok(
      newRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );

    proposalMerkleMap.set(proposalHash, newVoteBitArrayValue);

    // new vote is now casted let's retry passing the proposal
    const newproposalWitness = proposalMerkleMap.getWitness(proposalHash);
    const resolutionWitness = new ZkusdGovUpdateWitness(
      resolutionMerkleTree.getWitness(
        proposalSpec.govResolutionIndex.toBigint()
      )
    );

    const contractEventsBefore = await testHelper.council.fetchEvents();
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.passProposal(
          proposalSpec,
          newproposalWitness,
          newVoteBitArrayValue,
          resolutionWitness
        );
      },
      { name: 'Alice tries to pass a proposal with sufficient votes' }
    );
    const contractEventsAfter = await testHelper.council.fetchEvents();
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
    assert.ok(eventData.proposalHash.equals(proposalHash).toBoolean());
    assert.ok(
      eventData.resolutionIndex
        .equals(proposalSpec.govResolutionIndex)
        .toBoolean()
    );

    const actualResolutionRoot =
      await testHelper.council.resolutionsMerkleRoot.fetch();
    if (!actualResolutionRoot) {
      throw 'Could not fetch resolution merkle root';
    }
    const expectedResolutionRoot =
      resolutionWitness.calculateRoot(proposalHash);

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot).toBoolean());

    resolutionMerkleTree.setLeaf(
      proposalSpec.govResolutionIndex.toBigint(),
      proposalHash
    );
  });

  it('should be possible to rollup votes and pass the proposal using the rollup', async () => {
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
      councilSeatIndex,
      Number(proposalSpec.govResolutionIndex.add(UInt32.from(1)).toBigint())
    );
    proposalSpec = voteProof.publicInput;
    const proposalHash = Poseidon.hash(proposalSpec.toFields());

    const anothercouncilSeatIndex = 1;
    const anothervoteBitArray = Field(2 ** anothercouncilSeatIndex); // The seat index is encoded as 2^index
    const anothercouncilMember = council[anothercouncilSeatIndex];

    const anothervoteProof = await generateVoteProof(
      anothercouncilMember,
      councilMerkleTree,
      anothercouncilSeatIndex,
      Number(proposalSpec.govResolutionIndex.toBigint())
    );

    // now we haave two proofs lets merge them
    const mergedVotesProof =
      await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
        voteProof.publicInput,
        voteProof,
        anothervoteProof
      );

    const { proposalWitness, proposalCurrentVoteBitArray, resolutionWitness } =
      supportProposalHelper(
        mergedVotesProof.proof,
        proposalMerkleMap,
        resolutionMerkleTree
      );
    const contractEventsBefore = await testHelper.council.fetchEvents();
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.supportProposal(
          mergedVotesProof.proof,
          proposalWitness,
          proposalCurrentVoteBitArray,
          resolutionWitness
        );
      },
      { name: 'alice sends a rollup vote' }
    );

    const rolledupBitArray = voteBitArray.add(anothervoteBitArray);

    // verify if the vote was registered for the proposal.
    const [newRoot] = proposalWitness.computeRootAndKey(rolledupBitArray);
    // ensure that the root is set to this
    const actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      newRoot.equals(actualRoot).toBoolean(),
      'Proposal root does not match'
    );
    // update the tree to match the root
    proposalMerkleMap.set(
      voteProof.publicOutput.proposalHash,
      rolledupBitArray
    );

    // new vote is now casted let's retry passing the proposal
    const newproposalWitness = proposalMerkleMap.getWitness(proposalHash);
    assert.ok(
      newproposalWitness
        .computeRootAndKey(rolledupBitArray)[0]
        .equals(actualRoot)
        .toBoolean(),
      'Proposal root from new witness does not match'
    );

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.passProposal(
          proposalSpec,
          newproposalWitness,
          rolledupBitArray,
          resolutionWitness
        );
      },
      { name: 'Alice tries to pass a proposal #2' }
    );
    const contractEventsAfter = await testHelper.council.fetchEvents();

    // length of events should differ by 2
    assert.strictEqual(
      contractEventsAfter.length,
      contractEventsBefore.length + 2
    );

    const actualResolutionRoot =
      await testHelper.council.resolutionsMerkleRoot.fetch();
    if (!actualResolutionRoot) {
      throw 'Could not fetch resolution merkle root';
    }
    const expectedResolutionRoot =
      resolutionWitness.calculateRoot(proposalHash);

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot).toBoolean());

    resolutionMerkleTree.setLeaf(
      proposalSpec.govResolutionIndex.toBigint(),
      proposalHash
    );
  });

  it('should be possible to rebuild the resolution and proposal tree with gathered events', async () => {
    const events = await testHelper.council.fetchEvents();

    const proposalEvents = events.filter(
      (event) => event.type === 'ProposalSupported'
    );
    const resolutionEvents = events.filter(
      (event) => event.type === 'ProposalPassed'
    );

    // print counts of events
    console.log('Proposal events count:', proposalEvents.length);
    console.log('Resolution events count:', resolutionEvents.length);

    const proposalTree = new MerkleMap();
    const resolutionTree = new MerkleTree(ZKUSD_GOV_UPDATE_TREE_HEIGHT);

    proposalEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as CouncilProposalSupportChangeEvent;
      console.log(
        `setting proposal hash ${eventData.proposalHash.toString()} with vote bit array ${eventData.acceptedVoteBitArray.toString()}`
      );
      const votes = proposalTree.get(eventData.proposalHash);
      // since you cannot retract a vote this is fine
      if (eventData.acceptedVoteBitArray.greaterThan(votes).toBoolean()) {
        proposalTree.set(
          eventData.proposalHash,
          eventData.acceptedVoteBitArray
        );
      }
    });

    resolutionEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as CouncilProposalPassedEvent;
      resolutionTree.setLeaf(
        eventData.resolutionIndex.toBigint(),
        eventData.proposalHash
      );
    });

    const proposalTreeRoot = proposalTree.getRoot();
    const resolutionTreeRoot = resolutionTree.getRoot();

    const actualProposalTreeRoot =
      await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualProposalTreeRoot) {
      throw new Error('Proposal root is undefined');
    }
    assert.ok(
      proposalTreeRoot.equals(actualProposalTreeRoot).toBoolean(),
      'Proposal root does not match'
    );

    const actualResolutionTreeRoot =
      await testHelper.council.resolutionsMerkleRoot.fetch();

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
    const councilMember = council[councilSeatIndex];

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleTree,
      councilSeatIndex,
      0
    );

    proposalSpec = voteProof.publicInput;

    const contractEventsBefore = await testHelper.council.fetchEvents();

    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.council.supportProposalHelper(
            voteProof,
            proposalMerkleMap,
            resolutionMerkleTree
          );
        },
        { name: 'New proposal for the same resolution tx' }
      );
    });

    const contractEventsAfter = await testHelper.council.fetchEvents();
    //length of events should be the same
    assert.strictEqual(contractEventsAfter.length, contractEventsBefore.length);
  });

  describe('canExecuteGovResolution()', () => {
    let nameCounter = 0;
    /**
     * Helper that executes the view‑method inside a dry transaction
     * and returns its Bool result.
     */
    async function queryCanExecute(
      spec: ZkusdProtocolUpdateSpec,
      witness: ZkusdGovUpdateWitness
    ): Promise<Bool> {
      let ok: Bool = Bool(false);
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          ok = await testHelper.council.canExecuteGovResolution(
            Field(42),
            spec,
            witness
          );
        },
        { name: `canExecuteGovResolution #${nameCounter}` }
      );
      return ok;
    }

    it('returns *true* for a resolution that actually passed', async () => {
      const witness = new ZkusdGovUpdateWitness(
        resolutionMerkleTree.getWitness(
          proposalSpec.govResolutionIndex.toBigint()
        )
      );

      const res = await queryCanExecute(proposalSpec, witness);
      assert.ok(res.toBoolean(), 'expected execution to be allowed');
    });

    it('rejects when the proposal hash does **not** match the witness', async () => {
      // Same resolution slot, but totally different proposal data → hash mismatch
      const badSpec = ZkusdProtocolUpdateSpec.empty();
      badSpec.govResolutionIndex = proposalSpec.govResolutionIndex;

      const witness = new ZkusdGovUpdateWitness(
        resolutionMerkleTree.getWitness(
          proposalSpec.govResolutionIndex.toBigint()
        )
      );

      await assert.rejects(async () => {
        await queryCanExecute(badSpec, witness);
      });
    });

    it('rejects when the `govResolutionIndex` mismatches the witness', async () => {
      const badSpec = ZkusdProtocolUpdateSpec.empty();
      badSpec.govResolutionIndex = proposalSpec.govResolutionIndex.add(
        UInt32.from(1)
      );

      const witness = new ZkusdGovUpdateWitness(
        // witness still points at the *old* (passed) index
        resolutionMerkleTree.getWitness(
          proposalSpec.govResolutionIndex.toBigint()
        )
      );

      await assert.rejects(async () => {
        await queryCanExecute(badSpec, witness);
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
      const got = countBits(Field(val)).toBigInt();
      assert.strictEqual(got, BigInt(want));
    });
  });
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
