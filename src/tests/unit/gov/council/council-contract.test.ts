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
import { EngineUpdateSpec } from '../../../../system/engine-update/input.js';

import { ResolutionTree } from '../../../../system/council/data/resolution-tree.js';
import { generateVoteProof } from './common.js';
import { CouncilMap } from '../../../../system/council/data/council-map.js';
import { CouncilDataProvider } from '../../../../system/council/data/data-provider.js';
import { ProposalMap } from '../../../../system/council/data/proposal-merkle-map.js';
import { Seat } from '../../../../system/council/seat.js';
import {
  EngineUpdateProposalPassedEvent,
  EngineUpdateProposalVoteEvent,
} from '../../../../system/council/events.js';
import {
  EngineUpdateVoteProof,
  EngineUpdate,
} from '../../../../proofs/engine-update/prove.js';

describe('zkUSD Multisig Council Test Suite', () => {
  let testHelper: TestHelper<'local'>;
  let council: KeyPair[];
  let resolutionTree = new ResolutionTree();
  let updateSpec: EngineUpdateSpec;
  let govResolutionIndex: Number;
  let councilMerkleMap: CouncilMap;
  let proposalMerkleMap: ProposalMap;
  let resolutionMerkleTree: ResolutionTree;

  before(async () => {
    // Initialize test environment
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();
    await testHelper.createLocalAgents('alice');
    council = testHelper.networkKeys.council!;
  });
  it('should be possible to rebuild council merkle tree from emitted events', async () => {
    const dataProvider = CouncilDataProvider.fromContractEvents(
      testHelper.council
    );
    councilMerkleMap = await dataProvider.councilMap.get();

    const onChainRoot = await testHelper.council.councilMerkleMapRoot.fetch();

    if (!onChainRoot) {
      throw new Error('Council merkle map root is undefined');
    }

    assert.deepStrictEqual(councilMerkleMap.root, onChainRoot);
  });

  it('should be possible for a council member to create a proposal', async () => {
    const dataProvider = CouncilDataProvider.fromContractEvents(
      testHelper.council
    );

    const contractEventsBefore = await testHelper.council.fetchEvents();

    proposalMerkleMap = await dataProvider.proposalMap.get();
    resolutionMerkleTree = await dataProvider.resolutionTree.get();
    govResolutionIndex = Number(resolutionMerkleTree.getNextEmptyIndex());

    const councilSeatIndex = 0;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    console.log('Creating proof at the resolution index', govResolutionIndex);

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleMap,
      Seat.fromIndex(councilSeatIndex),
      govResolutionIndex as number
    );
    updateSpec = voteProof.publicInput;

    const { proposalWitness, proposalCurrentVoteBitArray, resolutionWitness } =
      supportProposalHelper(voteProof, proposalMerkleMap, resolutionMerkleTree);

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
      .data as unknown as EngineUpdateProposalVoteEvent;

    // check if the eventData matches the expected values
    assert.ok(eventData.proposalMapRootBefore.equals(rootBefore).toBoolean());
    assert.ok(eventData.acceptedVoteBitArray.equals(voteBitArray).toBoolean());
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
    const actualRoot = await testHelper.council.proposalsMerkleMapRoot.fetch();
    if (!actualRoot) {
      throw new Error('Proposal root is undefined');
    }

    const proposalHash = Poseidon.hash(updateSpec.toFields());
    const proposalWitness = proposalMerkleMap.getWitness(proposalHash);
    const proposalCurrentVoteBitArray = proposalMerkleMap.get(proposalHash);
    const resolutionWitness = new ResolutionTree.Witness(
      resolutionMerkleTree.getWitness(updateSpec.govResolutionIndex.toBigint())
    );

    const voteThreshold = await testHelper.council.votePassThreshold.fetch();

    voteThreshold?.assertGreaterThan(
      ProposalMap.countBits(proposalCurrentVoteBitArray)
    );

    const contractEventsBefore = await testHelper.council.fetchEvents();
    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.council.passProposal(
            updateSpec,
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
      Poseidon.hash(updateSpec.toFields())
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
      councilMerkleMap,
      Seat.fromIndex(councilSeatIndex),
      govResolutionIndex as number
    );
    updateSpec = voteProof.publicInput;

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
    const proposalHash = Poseidon.hash(updateSpec.toFields());
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
      councilMerkleMap,
      Seat.fromIndex(councilSeatIndex),
      govResolutionIndex as number
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
    const resolutionWitness =
      resolutionMerkleTree.getWitnessWrapped(updateSpec);

    const contractEventsBefore = await testHelper.council.fetchEvents();
    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.passProposal(
          updateSpec,
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
      .data as unknown as EngineUpdateProposalPassedEvent;
    // check if the eventData matches the expected values
    assert.ok(eventData.updateHash.equals(proposalHash).toBoolean());
    assert.ok(
      eventData.resolutionIndex
        .equals(updateSpec.govResolutionIndex)
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
      updateSpec.govResolutionIndex.toBigint(),
      proposalHash
    );
  });

  it('should be possible to rollup votes and pass the proposal using the rollup', async () => {
    const councilSeatIndex = 0;
    const voteBitArray = Field(2 ** councilSeatIndex); // The seat index is encoded as 2^index
    const councilMember = council[councilSeatIndex];

    const voteProof = await generateVoteProof(
      councilMember,
      councilMerkleMap,
      Seat.fromIndex(councilSeatIndex),
      Number(updateSpec.govResolutionIndex.add(UInt32.from(1)).toBigint())
    );
    updateSpec = voteProof.publicInput;
    const proposalHash = Poseidon.hash(updateSpec.toFields());

    const anothercouncilSeatIndex = 1;
    const anothervoteBitArray = Field(2 ** anothercouncilSeatIndex); // The seat index is encoded as 2^index
    const anothercouncilMember = council[anothercouncilSeatIndex];

    const anothervoteProof = await generateVoteProof(
      anothercouncilMember,
      councilMerkleMap,
      Seat.fromIndex(anothercouncilSeatIndex),
      Number(updateSpec.govResolutionIndex.toBigint())
    );

    // now we haave two proofs lets merge them
    const mergedVotesProof = await EngineUpdate.mergeVotes(
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
          updateSpec,
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
      updateSpec.govResolutionIndex.toBigint(),
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

    const proposalTree = new MerkleMap();
    const resolutionTree = new MerkleTree(ResolutionTree.HEIGHT);

    proposalEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as EngineUpdateProposalVoteEvent;

      const votes = proposalTree.get(eventData.updateHash);
      // since you cannot retract a vote this is fine
      if (eventData.acceptedVoteBitArray.greaterThan(votes).toBoolean()) {
        proposalTree.set(eventData.updateHash, eventData.acceptedVoteBitArray);
      }
    });

    resolutionEvents.forEach((event) => {
      const eventData = event.event
        .data as unknown as EngineUpdateProposalPassedEvent;
      resolutionTree.setLeaf(
        eventData.resolutionIndex.toBigint(),
        eventData.updateHash
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
      councilMerkleMap,
      Seat.fromIndex(councilSeatIndex),
      1
    );

    updateSpec = voteProof.publicInput;

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
      spec: EngineUpdateSpec,
      witness: ResolutionTree.Witness
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
      const dataProvider = CouncilDataProvider.fromContractEvents(
        testHelper.council
      );
      resolutionMerkleTree = await dataProvider.resolutionTree.get();

      const witnessAtUpdateSpecResolutionIndex = new ResolutionTree.Witness(
        resolutionMerkleTree.getWitness(
          updateSpec.govResolutionIndex.toBigint()
        )
      );

      const witnessAtIndexGovResolutionIndex = new ResolutionTree.Witness(
        resolutionMerkleTree.getWitness(
          updateSpec.govResolutionIndex.toBigint()
        )
      );

      const res = await queryCanExecute(
        updateSpec,
        witnessAtUpdateSpecResolutionIndex
      );
      assert.ok(res.toBoolean(), 'expected execution to be allowed');
    });

    it('rejects when the proposal hash does **not** match the witness', async () => {
      // Same resolution slot, but totally different proposal data → hash mismatch
      const badSpec = EngineUpdateSpec.empty();
      badSpec.govResolutionIndex = updateSpec.govResolutionIndex;

      const witness = new ResolutionTree.Witness(
        resolutionMerkleTree.getWitness(
          updateSpec.govResolutionIndex.toBigint()
        )
      );

      await assert.rejects(async () => {
        await queryCanExecute(badSpec, witness);
      });
    });

    it('rejects when the `govResolutionIndex` mismatches the witness', async () => {
      const badSpec = EngineUpdateSpec.empty();
      badSpec.govResolutionIndex = updateSpec.govResolutionIndex.add(
        UInt32.from(1)
      );

      const witness = new ResolutionTree.Witness(
        // witness still points at the *old* (passed) index
        resolutionMerkleTree.getWitness(
          updateSpec.govResolutionIndex.toBigint()
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
      const got = ProposalMap.countBits(Field(val)).toBigInt();
      assert.strictEqual(got, BigInt(want));
    });
  });
});

function supportProposalHelper(
  voteProof: EngineUpdateVoteProof,
  proposalTree: MerkleMap,
  resolutionTree: MerkleTree
) {
  const proposalWitness = proposalTree.getWitness(
    voteProof.publicOutput.proposalHash
  );
  const resolutionWitness = new ResolutionTree.Witness(
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
