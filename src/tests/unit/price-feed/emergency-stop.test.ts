import { AccountUpdate, Bool } from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import { ProtocolData, ZkUsdEngineErrors } from '../../../system/engine.js';

describe('zkUSD Price Feed Emergency Stop Test Suite', () => {
  let th: TestHelper<'local'>;
  let priceOneUsd: MinaPriceInput;
  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice');

    await th.createVaults('alice');

    priceOneUsd = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    //Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'depositCollateral' }
    );
  });

  it('should allow the protocol to be stopped', async () => {
    await th.stopTheProtocol();

    const protocolDataPacked =
      await th.engine.contract.protocolDataPacked.fetch();

    const protocolData = ProtocolData.unpack(protocolDataPacked!);

    const emergencyStopFlag = protocolData.emergencyStop;

    assert.deepStrictEqual(emergencyStopFlag, Bool(true));
  });

  it('should emit the emergency stop event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'EmergencyStopToggled');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.emergencyStop,
      Bool(true)
    );
  });

  it('should allow the protocol to be resumed', async () => {
    await th.resumeTheProtocol();

    const emergencyStopFlag =
      await th.engine.contract.protocolDataPacked.fetch();

    const protocolData = ProtocolData.unpack(emergencyStopFlag!);

    assert.deepStrictEqual(protocolData.emergencyStop, Bool(false));
  });

  it('should emit the emergency resume event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'EmergencyStopToggled');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.emergencyStop,
      Bool(false)
    );
  });

  it('should not allow vault actions when the protocol is stopped', async () => {
    await th.stopTheProtocol();

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          AccountUpdate.fundNewAccount(th.agents.alice.keys.publicKey, 1);
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_5_ZKUSD,
            priceOneUsd
          );
        },
        { name: 'mintZkUsd #1' }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
  });

  it('should allow vault actions when the protocol is resumed', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_5_ZKUSD,
            priceOneUsd
          );
        },
        { name: 'mintZkUsd #2' }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));

    await th.resumeTheProtocol();

    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'mintZkUsd #3' }
    );

    const vaultBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(vaultBalance, TestAmounts.DEBT_5_ZKUSD);
  });
});
