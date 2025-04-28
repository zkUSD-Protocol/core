import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  Bool,
  Field,
  PrivateKey,
  Poseidon,
  UInt32,
  UInt8,
  MerkleTree,
  MerkleMap,
  UInt64,
} from 'o1js';
import { TestHelper } from '../../test-helper.js';
import { ZkusdProtocolUpdateSpec } from '../../../system/update/input.js';
import {
  MinaChainPreconditions,
  ValidityRangeUInt32,
} from '../../../system/update/blockchain-preconditions.js';
import { ZkusdProtocolPreconditions } from '../../../system/update/protocol-preconditions.js';
import {
  generateVoteProof,
  getNextEmptyResolutionIndex,
  rebuildCouncilMembersAndTree,
  rebuildProposalMerkleMap,
  rebuildResolutionMerkleTree,
} from './council/common.js';
import { MultiSigZkusdProtocolUpdateProgram } from '../../../proofs/gov/council-multisig.js';
import { ZkusdGovUpdateWitness } from '../../../system/governance.js';
import {
  BoolOperation,
  FieldOperation,
  UInt64Operation,
  UInt8Operation,
} from '../../../system/update/simple-operations.js';
import { OracleWhitelist } from '../../../system/oracle.js';
import { BoolPrecondition } from '../../../system/update/simple-preconditions.js';
import { ZkusdProtocolUpdateOperation } from '../../../system/update/operation.js';

let testHelper: TestHelper<'local'>;
const engine = () => testHelper.engine.contract;

const engineVK = () =>
  testHelper!.zkusdCompilationData()!.zkusdEngineContractVk;

const EMERGENCY_STOP_VAL = Bool(true);
const VALID_PRICE_BLOCK_COUNT_VAL = UInt8.from(42);
const LIQ_BONUS_RATIO_VAL = UInt8.from(7);
const COLLATERAL_RATIO_VAL = UInt8.from(175);
const ORACLE_WHITELIST = {
  addresses: Array.from({ length: 8 }, () => PrivateKey.random().toPublicKey()),
};
const ORACLE_WL_HASH = Poseidon.hash(
  OracleWhitelist.toFields(ORACLE_WHITELIST)
);
const CONFIG_ROOT_VAL = Field.random();
const VAULT_DEBT_CEILING_VAL = UInt64.from(5e14);

function makeDefaultAcceptedSpec(resIndex: UInt32) {
  const spec = ZkusdProtocolUpdateSpec.empty();
  spec.govResolutionIndex = resIndex;
  spec.protocolUpdateOperation = ZkusdProtocolUpdateOperation.create({
    emergencyStop: BoolOperation.set(EMERGENCY_STOP_VAL),
    validPriceBlockCount: UInt8Operation.set(VALID_PRICE_BLOCK_COUNT_VAL),
    liquidationBonusRatio: UInt8Operation.set(LIQ_BONUS_RATIO_VAL),
    collateralRatio: UInt8Operation.set(COLLATERAL_RATIO_VAL),
    oracleWhitelistHash: FieldOperation.set(ORACLE_WL_HASH),
    configMerkleRoot: FieldOperation.set(CONFIG_ROOT_VAL),
    newVerificationKey: FieldOperation.set(engineVK()!.hash),
    vaultDebtCeiling: UInt64Operation.set(VAULT_DEBT_CEILING_VAL),
    vaultCreationDisabled: BoolOperation.set(VAULT_CREATION_DISABLED_VAL),
  });
  spec.blockchainPreconditions = MinaChainPreconditions.always();
  spec.protocolUpdatePreconditions = ZkusdProtocolPreconditions.create();
  return spec;
}

let updateSpec: ZkusdProtocolUpdateSpec;

/* -------------------------------------------------------------------------- */
/* 3.  Test‑case table – now no randomness                                    */
/*     Each makeOperation pulls from global `updateSpec`.                     */
/* -------------------------------------------------------------------------- */
const VAULT_CREATION_DISABLED_VAL = Bool(true);

const testsToRun: TestCase[] = [
  {
    title: 'Toggle vault creation',
    call: 'govToggleVaultCreation',
    makeOperation() {
      return { newValue: VAULT_CREATION_DISABLED_VAL };
    },
    async verifyState(v) {
      (await engine().getProtocolData()).vaultCreationDisabled.assertEquals(v);
    },
    event: 'VaultCreationToggled',
  },
  {
    title: 'Toggle emergency stop',
    call: 'govToggleEmergencyStop',
    makeOperation() {
      return {
        newValue: EMERGENCY_STOP_VAL,
      };
    },
    async verifyState(v) {
      engine().isEmergencyStopped().assertEquals(v);
    },
    event: 'EmergencyStopToggled',
  },
  {
    title: 'Change verification key',
    call: 'govUpdateEngineVerificationKey',
    makeOperation() {
      return {
        newValue: engineVK(),
      };
    },
    async verifyState() {},
    event: 'VerificationKeyUpdated',
  },
  {
    title: 'Update valid price block count',
    call: 'govUpdateValidPriceBlockCount',
    makeOperation() {
      return {
        newValue: VALID_PRICE_BLOCK_COUNT_VAL,
      };
    },
    async verifyState(v) {
      (await engine().getValidPriceBlockCount()).assertEquals(v);
    },
    event: 'ValidPriceBlockCountUpdated',
  },
  {
    title: 'Update liquidation bonus ratio',
    call: 'govUpdateLiquidationBonusRatio',
    makeOperation() {
      return {
        newValue: LIQ_BONUS_RATIO_VAL,
      };
    },
    async verifyState(v) {
      (await engine().getProtocolData()).liquidationBonusRatio.assertEquals(v);
    },
    event: 'LiquidationBonusRatioUpdated',
  },
  {
    title: 'Update collateral ratio',
    call: 'govUpdateCollateralRatio',
    makeOperation() {
      return {
        newValue: COLLATERAL_RATIO_VAL,
      };
    },
    async verifyState(v) {
      (await engine().getProtocolData()).collateralRatio.assertEquals(v);
    },
    event: 'CollateralRatioUpdated',
  },
  {
    title: 'Update oracle whitelist hash',
    call: 'govUpdateOracleWhitelist',
    makeOperation() {
      return {
        newValue: ORACLE_WHITELIST,
      };
    },
    async verifyState(wl) {
      const h = Poseidon.hash(OracleWhitelist.toFields(wl));
      engine().oracleWhitelistHash.getAndRequireEquals().assertEquals(h);
    },
    event: 'OracleWhitelistUpdated',
  },
  {
    title: 'Update config merkle root',
    call: 'govUpdateConfigMerkleRoot',
    makeOperation() {
      return {
        newValue: CONFIG_ROOT_VAL,
      };
    },
    async verifyState(root) {
      engine().configMerkleRoot.getAndRequireEquals().assertEquals(root);
    },
    event: 'ConfigMerkleRootUpdated',
  },
  {
    title: 'Update vault debt ceiling',
    call: 'govUpdateVaultDebtCeiling',
    makeOperation() {
      return {
        newValue: VAULT_DEBT_CEILING_VAL,
      };
    },
    async verifyState(v) {
      (await engine().getProtocolData()).vaultDebtCeiling.assertEquals(v);
    },
    event: 'VaultDebtCeilingUpdated',
  },
  {
    title: 'Toggle vault creation',
    call: 'govToggleVaultCreation',
    makeOperation() {
      return { newValue: VAULT_CREATION_DISABLED_VAL };
    },
    async verifyState(v) {
      (await engine().getProtocolData()).vaultCreationDisabled.assertEquals(v);
    },
    event: 'VaultCreationToggled',
  },
];

/* -------------------------------------------------------------------------- */
/*                            Test case structure                             */
/* -------------------------------------------------------------------------- */

type TestCase = {
  title: string;
  call:
    | 'govToggleEmergencyStop'
    | 'govUpdateValidPriceBlockCount'
    | 'govUpdateLiquidationBonusRatio'
    | 'govUpdateCollateralRatio'
    | 'govUpdateOracleWhitelist'
    | 'govUpdateEngineVerificationKey'
    | 'govUpdateConfigMerkleRoot'
    | 'govUpdateVaultDebtCeiling'
    | 'govToggleVaultCreation'
    | 'govToggleEmergencyStop';
  makeOperation(): { newValue: any };
  verifyState(newValue: any): Promise<void>;
  event: string;
};

/* -------------------------------------------------------------------------- */
/*                                   Tests                                    */
/* -------------------------------------------------------------------------- */

describe('Engine – governance‑controlled setters', () => {
  let updateWitness: ZkusdGovUpdateWitness;
  let councilTree: MerkleTree;
  let proposalMap: MerkleMap;
  let resolutionTree: MerkleTree;

  before(async () => {
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();
    await testHelper.createLocalAgents('alice');
    await testHelper.createLocalAgents('bob');

    const events = await testHelper.council.fetchEvents();
    ({ councilTree } = rebuildCouncilMembersAndTree(events));
    proposalMap = rebuildProposalMerkleMap(events);
    resolutionTree = rebuildResolutionMerkleTree(events);

    const govResolutionIndex = getNextEmptyResolutionIndex(resolutionTree);
    updateSpec = makeDefaultAcceptedSpec(govResolutionIndex);

    const councilKeyPairs = testHelper.networkKeys.council!;
    const voteA = await generateVoteProof(
      councilKeyPairs[0],
      councilTree,
      0,
      Number(govResolutionIndex.toBigint()),
      updateSpec
    );
    const voteB = await generateVoteProof(
      councilKeyPairs[1],
      councilTree,
      1,
      Number(govResolutionIndex.toBigint()),
      updateSpec
    );

    const merged = await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
      voteA.publicInput,
      voteA,
      voteB
    );

    const proposalHash = merged.proof.publicOutput.proposalHash;
    const voteBits = merged.proof.publicOutput.cummulatedVoteBitArray;

    await testHelper.includeTx(testHelper.agents.alice.keys, async () => {
      await testHelper.council.supportProposalHelper(
        merged.proof,
        proposalMap,
        resolutionTree
      );
    });

    proposalMap.set(proposalHash, voteBits);
    const proposalWitness = proposalMap.getWitness(proposalHash);

    await testHelper.includeTx(testHelper.agents.alice.keys, async () => {
      await testHelper.council.passProposal(
        updateSpec,
        proposalWitness,
        voteBits,
        new ZkusdGovUpdateWitness(
          resolutionTree.getWitness(govResolutionIndex.toBigint())
        )
      );
    });

    resolutionTree.setLeaf(govResolutionIndex.toBigint(), proposalHash);
    updateWitness = new ZkusdGovUpdateWitness(
      resolutionTree.getWitness(govResolutionIndex.toBigint())
    );
  });

  for (const tc of testsToRun) {
    describe(tc.title, () => {
      it('✅ happy‑path succeeds', async () => {
        const { newValue } = tc.makeOperation();
        const eventsBefore = await engine().fetchEvents();
        await testHelper.includeTx(testHelper.agents.alice.keys, async () => {
          if (
            tc.call === 'govUpdateOracleWhitelist' ||
            tc.call === 'govUpdateEngineVerificationKey'
          ) {
            await engine()[tc.call](newValue, updateSpec, updateWitness);
          } else {
            await engine()[tc.call](updateSpec, updateWitness);
          }
        });
        await tc.verifyState(newValue);
        const events = await engine().fetchEvents();
        assert.strictEqual(events.length, eventsBefore.length + 1);
        assert.strictEqual(events[0].type, tc.event);
      });

      it('❌ gov rejects → fails', async () => {
        const { newValue } = tc.makeOperation();
        const badSpecIndex = updateSpec.govResolutionIndex.add(1);
        const spec = makeDefaultAcceptedSpec(badSpecIndex);
        const witness = new ZkusdGovUpdateWitness(
          resolutionTree.getWitness(badSpecIndex.toBigint())
        );
        await assert.rejects(async () => {
          await testHelper.includeTx(testHelper.agents.alice.keys, async () => {
            if (
              tc.call === 'govUpdateOracleWhitelist' ||
              tc.call === 'govUpdateEngineVerificationKey'
            ) {
              await engine()[tc.call](newValue, spec, witness);
            } else {
              await engine()[tc.call](spec, witness);
            }
          });
        });
      });

      it('❌ bad blockchain preconditions → fails', async () => {
        const { newValue } = tc.makeOperation();
        const badSpec = makeDefaultAcceptedSpec(updateSpec.govResolutionIndex);
        const currentSlot = await testHelper.mina.getCurrentSlot();
        badSpec.blockchainPreconditions = MinaChainPreconditions.slotRange(
          currentSlot.add(50000),
          currentSlot.add(50001)
        );
        await assert.rejects(async () => {
          await testHelper.includeTx(testHelper.agents.alice.keys, async () => {
            if (
              tc.call === 'govUpdateOracleWhitelist' ||
              tc.call === 'govUpdateEngineVerificationKey'
            ) {
              await engine()[tc.call](newValue, badSpec, updateWitness);
            } else {
              await engine()[tc.call](badSpec, updateWitness);
            }
          });
        });
      });

      it('❌ bad protocol preconditions → fails', async () => {
        const { newValue } = tc.makeOperation();
        const badSpec = makeDefaultAcceptedSpec(updateSpec.govResolutionIndex);
        badSpec.protocolUpdatePreconditions = ZkusdProtocolPreconditions.create(
          {
            emergencyStop: BoolPrecondition.equal(true),
          }
        );
        await assert.rejects(async () => {
          await testHelper.includeTx(testHelper.agents.bob.keys, async () => {
            if (
              tc.call === 'govUpdateOracleWhitelist' ||
              tc.call === 'govUpdateEngineVerificationKey'
            ) {
              await engine()[tc.call](newValue, badSpec, updateWitness);
            } else {
              await engine()[tc.call](badSpec, updateWitness);
            }
          });
        });
      });
    });
  }
});
