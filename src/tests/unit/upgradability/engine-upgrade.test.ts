import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import { ZkUsdEngineUpgradeContract } from './contracts/zkusd-engine-upgrade.js';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
} from '../../../proofs/oracle-price-aggregation/prove.js';
import {
  AccountUpdate,
  Bool,
  Field,
  Poseidon,
  UInt32,
  VerificationKey,
} from 'o1js';

import { validPriceBlockCount } from '../../../mina/networks.js';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import assert from 'node:assert';
import { ContractInstance } from '../../../types/utility.js';
import { ProtocolData, ProtocolDataPacked } from '../../../system/engine.js';
import { OracleWhitelist } from '../../../system/oracle.js';

describe('zkUSD Upgradability - Engine Upgrade Test Suite', () => {
  let th: TestHelper<'local'>;
  let oneUsdPrice: MinaPriceInput;
  let originalEngineVerificationKey: VerificationKey;
  let upgradedEngineVerificationKey: VerificationKey;
  let upgradedEngine: ContractInstance<
    ReturnType<typeof ZkUsdEngineUpgradeContract>
  >;
  let secret: Field = Field(1234);

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: true });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice');
    await th.createVaults('alice');

    //Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'Upgradability Test Suite: Alice deposits 100 Mina' }
    );

    oneUsdPrice = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    //Alice mints 5 zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          oneUsdPrice
        );
      },
      { name: 'Upgradability Test Suite: Alice mints 5 zkUSD' }
    );

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    originalEngineVerificationKey = engineAccount?.zkapp?.verificationKey!;

    const ZkUsdEngineUpgrade = ZkUsdEngineUpgradeContract({
      zkUsdTokenAddress: th.networkKeys.token.publicKey,
      minaPriceInputZkProgramVkHash: th.oracleAggregationVk.hash,
    });

    const upgradedEngineCompiled = await ZkUsdEngineUpgrade.compile();
    await ZkUsdEngineUpgrade.FungibleToken.compile();

    upgradedEngineVerificationKey = upgradedEngineCompiled.verificationKey;

    upgradedEngine = {
      contract: new ZkUsdEngineUpgrade(th.networkKeys.engine.publicKey),
    };
  });

  it('should fail to execute a method on the upgraded engine before the vk is updated', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await upgradedEngine.contract.canChangeAdmin(
              th.networkKeys.protocolAdmin.publicKey
            );
          },
          {
            name: 'Upgradability Test Suite: Alice attempts to call a method on the upgraded engine before the vk is updated',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Invalid proof for account update/i);
        return true;
      }
    );
  });

  it('should fail to upgrade the engine without the correct signature', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            const au = AccountUpdate.create(th.networkKeys.engine.publicKey);

            au.body.update.verificationKey = {
              isSome: Bool(true),
              value: upgradedEngineVerificationKey,
            };
          },
          {
            name: 'Upgradability Test Suite: Alice attempts to upgrade the engine without the correct signature',
          }
        );
      },
      (err: any) => {
        assert.match(
          err.message,
          /Cannot update field 'verificationKey' because permission for this field is 'Signature'/i
        );
        return true;
      }
    );
  });

  it('should allow the engine vk to be updated with the correct signature', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        const au = AccountUpdate.createSigned(th.networkKeys.engine.publicKey);

        au.body.update.verificationKey = {
          isSome: Bool(true),
          value: upgradedEngineVerificationKey,
        };
      },
      {
        name: 'Upgradability Test Suite: Alice upgrades the engine with the correct signature',
        extraSigners: [th.networkKeys.engine.privateKey],
      }
    );

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    assert.deepStrictEqual(
      engineAccount?.zkapp?.verificationKey,
      upgradedEngineVerificationKey
    );
  });

  it('should maintain the current state of the engine after the upgrade', async () => {
    const engineTrackingAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,

      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );

    const expectedCollateral = TestAmounts.COLLATERAL_100_MINA;

    assert.deepStrictEqual(engineTrackingAccount?.balance, expectedCollateral);

    const expectedProtocolDataPacked: ProtocolDataPacked = ProtocolData.new({
      admin: th.networkKeys.protocolAdmin.publicKey,
      validPriceBlockCount: UInt32.from(
        validPriceBlockCount[th.txMgr.mina.network.chainId]
      ),
      emergencyStop: Bool(false),
    }).pack();

    const expectedOracleWhitelistHash = OracleWhitelist.hash(th.whitelist);

    const expectedInteractionFlag = Bool(false);

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    const expectedAppState = [
      expectedOracleWhitelistHash,
      ...ProtocolDataPacked.toFields(expectedProtocolDataPacked),
      expectedInteractionFlag.toField(),
      Field(0),
      Field(0),
      Field(0),
      Field(0),
    ];

    assert.deepStrictEqual(engineAccount?.zkapp?.appState, expectedAppState);
  });

  it('should fail to call a method on the original engine after the upgrade', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD,
              oneUsdPrice
            );
          },
          {
            name: 'Upgradability Test Suite: Alice attempts to mint 5 zkUSD on the original engine after the upgrade',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Invalid proof for account update/i);
        return true;
      }
    );
  });

  it('should allow the initialization of the upgraded engine', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await upgradedEngine.contract.initialize(
          secret,
          th.whitelist,
          UInt32.from(25)
        );
      },
      {
        name: 'Upgradability Test Suite: Alice initializes the upgraded engine',
      }
    );

    console;

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    const expectedZkAppState = [
      OracleWhitelist.hash(th.whitelist),
      UInt32.from(25).toFields()[0],
      Poseidon.hash([secret]),
      Bool(false).toField(),
      Bool(false).toField(),
      Field(0),
      Field(0),
      Field(0),
    ];

    assert.deepStrictEqual(engineAccount?.zkapp?.appState, expectedZkAppState);
  });

  it('should allow us to call a method on the upgraded engine', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await upgradedEngine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          oneUsdPrice
        );
      },
      {
        name: 'Upgradability Test Suite: Alice mints 5 zkUSD on the upgraded engine',
      }
    );

    const aliceTokenBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    //We already minted 5 zkUSD on the original engine, so we should have 10 zkUSD now
    assert.deepStrictEqual(aliceTokenBalance, TestAmounts.DEBT_10_ZKUSD);
  });

  it('should allow us to perform admin actions on the upgraded engine with the secret', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await upgradedEngine.contract.toggleEmergencyStop(Bool(true), secret);
      },
      {
        name: 'Upgradability Test Suite: Alice toggles the emergency stop on the upgraded engine',
      }
    );

    const isStopped = await upgradedEngine.contract.emergencyStop.fetch();

    assert.deepStrictEqual(isStopped, Bool(true));
  });
});
