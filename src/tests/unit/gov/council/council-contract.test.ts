import { AccountUpdate, Field, MerkleMap, MerkleTree, Poseidon, Signature, UInt32 } from 'o1js';
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
  seatIndex: number,
  govResolutionIndex: number = 0
): Promise<ZkusdGoverningCouncilVoteProof> {
  // an example of a update - an empty one, but its okay for these tests.
  const updateInput = ZkusdProtocolUpdateSpec.empty();
  updateInput.govResolutionIndex = UInt32.from(govResolutionIndex);
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
      councilMerkleTree.getRoot().equals(councilContractRoot).toBoolean(),
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
    assert.ok(newRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');
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
    assert.ok(expectedRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');

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
    assert.ok(expectedRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');

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
    assert.ok(expectedRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');

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
    assert.ok(newRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');

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

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot).toBoolean());

    resolutionMerkleTree.setLeaf(proposalSpec.govResolutionIndex.toBigint(), proposalHash);
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
    const mergedVotesProof = await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
      voteProof.publicInput,
      voteProof,
      anothervoteProof,
    );

    const { proposalWitness, proposalCurrentVoteBitArray, resolutionWitness } =
      supportProposalHelper(mergedVotesProof.proof , proposalMerkleMap, resolutionMerkleTree);
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
    assert.ok(newRoot.equals(actualRoot).toBoolean(), 'Proposal root does not match');
    // update the tree to match the root
    proposalMerkleMap.set(voteProof.publicOutput.proposalHash, rolledupBitArray)

    // new vote is now casted let's retry passing the proposal
    const newproposalWitness = proposalMerkleMap.getWitness(proposalHash);
    assert.ok(newproposalWitness.computeRootAndKey(rolledupBitArray)[0].equals(actualRoot).toBoolean(), 'Proposal root from new witness does not match');

    await testHelper.includeTx(
      testHelper.agents.alice.keys,
      async () => {
        await testHelper.council.passProposal(proposalSpec, newproposalWitness, rolledupBitArray, resolutionWitness)
      },
      { name: 'Alice tries to pass a proposal #2' }
    );

    const actualResolutionRoot = await testHelper.council.resolutionsMerkleRoot.fetch();
    if(!actualResolutionRoot){
      throw "Could not fetch resolution merkle root"
    }
    const expectedResolutionRoot = resolutionWitness.calculateRoot(proposalHash);

    assert.ok(actualResolutionRoot.equals(expectedResolutionRoot).toBoolean());

    resolutionMerkleTree.setLeaf(proposalSpec.govResolutionIndex.toBigint(), proposalHash);
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
