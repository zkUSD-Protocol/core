import { AccountUpdate, Field, Mina, PrivateKey, UInt32 } from 'o1js';
import { TestAmounts, TestHelper } from '../unit-test-helper.js';
import { ProtocolData } from '../../../types.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Protocol Oracle Fee Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice']);
  });

  it('should allow the fee to be changed with the admin key', async () => {
    const newFee = TestAmounts.COLLATERAL_2_MINA;

    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleFee(newFee);
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const packedData =
      await testHelper.engine.contract.protocolDataPacked.fetch();

    const protocolData = ProtocolData.unpack(packedData!);

    assert.deepStrictEqual(protocolData.oracleFlatFee, newFee);
  });

  it('should emit the oracle fee update event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'OracleFeeUpdated');

    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.newFee,
      TestAmounts.COLLATERAL_2_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.previousFee,
      TestAmounts.COLLATERAL_1_MINA
    );
  });

  it('should not allow the fee to be changed without the admin key', async () => {
    const newFee = TestAmounts.COLLATERAL_1_MINA;

    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.updateOracleFee(newFee);
      });
    }, /Transaction verification failed/i);
  });

  it('should not allow the private key to manually send funds from the engine', async () => {
    const oracleBalanceBefore = Mina.getBalance(
      testHelper.networkKeys.engine.publicKey
    );

    await assert.rejects(async () => {
      await transaction(
        testHelper.agents.alice.keys,
        async () => {
          const sendUpdate = AccountUpdate.create(
            testHelper.networkKeys.engine.publicKey
          );
          sendUpdate.send({
            to: testHelper.agents.alice.keys.publicKey,
            amount: oracleBalanceBefore,
          });
        },
        {
          extraSigners: [testHelper.networkKeys.engine.privateKey],
        }
      );
    }, /Update_not_permitted_balance/i);
  });

  it('should pay out the oracle fee correctly', async () => {
    const packedData =
      await testHelper.engine.contract.protocolDataPacked.fetch();
    const protocolData = ProtocolData.unpack(packedData!);
    const oracleFee = protocolData.oracleFlatFee;

    //get the current balance of the price feed oracle
    const priceFeedOracleBalanceBefore = Mina.getBalance(
      testHelper.networkKeys.engine.publicKey
    );
    const whitelistedOracles = testHelper.whitelistedOracles;
    const oracleName = Array.from(whitelistedOracles.keys())[0];
    const oracle = testHelper.oracles[oracleName];

    // Get oracle's initial balance
    const oracleBalanceBefore = Mina.getBalance(oracle.publicKey);

    // Submit price from oracle
    await transaction(
      oracle,
      async () => {
        await testHelper.engine.contract.submitPrice(
          TestAmounts.PRICE_25_CENT,
          testHelper.whitelist
        );
      },
      {
        printTx: true,
      }
    );

    // Get oracle's balance after submission
    const oracleBalanceAfter = Mina.getBalance(oracle.publicKey);

    const priceFeedOracleBalanceAfter = Mina.getBalance(
      testHelper.networkKeys.engine.publicKey
    );

    // Verify oracle received the fee
    assert.strictEqual(
      oracleBalanceAfter.toString(),
      oracleBalanceBefore.add(oracleFee).toString()
    );

    assert.deepStrictEqual(
      priceFeedOracleBalanceBefore.sub(priceFeedOracleBalanceAfter),
      oracleFee
    );
  });
});
