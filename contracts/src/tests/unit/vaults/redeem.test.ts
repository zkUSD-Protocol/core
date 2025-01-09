import { TestHelper, TestAmounts } from '../../test-helper.js';
import { AccountUpdate, Field, Mina, UInt64 } from 'o1js';
import { ZkUsdVaultErrors } from '../../../contracts/zkusd-vault.js';
import { ZkUsdEngineErrors } from '../../../contracts/zkusd-engine.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Vault Redeem Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLocalChain({proofsEnabled: false});
    await testHelper.deployTokenContracts();
    await testHelper.createAgents(['alice', 'bob', 'charlie', 'rewards']);

    //deploy alice's vault
    await testHelper.createVaults(['alice', 'bob']);

    //Alice deposits 100 Mina
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    //Alice mints 5 zkUSD
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_5_ZKUSD
      );
    });
  });

  const redeemCollateral = async (amount: UInt64, shouldPrintTx = false) => {
    try {
      const txResult = await transaction(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.redeemCollateral(
            testHelper.agents.alice.vault!.publicKey,
            amount
          );
        },
        {
          printTx: shouldPrintTx,
        }
      );
      return txResult;
    } catch (e) {
      throw e;
    }
  };

  it('should allow alice to redeem collateral', async () => {
    const initialCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    const aliceBalanceBefore = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    await redeemCollateral(TestAmounts.COLLATERAL_1_MINA);

    const finalCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    const aliceBalanceAfter = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(
      finalCollateral,
      initialCollateral?.sub(TestAmounts.COLLATERAL_1_MINA)
    );
    assert.deepStrictEqual(
      aliceBalanceAfter,
      aliceBalanceBefore.add(TestAmounts.COLLATERAL_1_MINA)
    );
  });

  it('should emit the RedeemCollateral event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'RedeemCollateral');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.amountRedeemed,
      TestAmounts.COLLATERAL_1_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralAmount,
      TestAmounts.COLLATERAL_100_MINA.sub(TestAmounts.COLLATERAL_1_MINA)
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtAmount,
      TestAmounts.DEBT_5_ZKUSD
    );
  });

  it('should fail if the amount redeemed is zero', async () => {
    const aliceBalanceBefore = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    await assert.rejects(
      async () => {
        await redeemCollateral(TestAmounts.ZERO);
      },
      {
        message: ZkUsdVaultErrors.AMOUNT_ZERO,
      }
    );

    const aliceBalanceAfter = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );
    assert.deepStrictEqual(aliceBalanceAfter, aliceBalanceBefore);
  });

  it('should fail if the user tries to send Mina from the engine without proof', async () => {
    const totalDepositedCollateral =
      await testHelper.engine.contract.getTotalDepositedCollateral();

    await assert.rejects(
      async () => {
        await transaction(
          testHelper.agents.alice.keys,
          async () => {
            let au = AccountUpdate.createSigned(
              testHelper.networkKeys.engine.publicKey
            );
            au.send({
              to: testHelper.agents.alice.keys.publicKey,
              amount: totalDepositedCollateral,
            });
          },
          {
            extraSigners: [testHelper.networkKeys.engine.privateKey],
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Update_not_permitted_balance/i);
        return true;
      }
    );
  });

  it('should fail if the redeemer is not the owner', async () => {
    await assert.rejects(
      async () => {
        await transaction(testHelper.agents.bob.keys, async () => {
          await testHelper.engine.contract.redeemCollateral(
            testHelper.agents.alice.vault!.publicKey,
            TestAmounts.COLLATERAL_1_MINA
          );
        });
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );
  });

  it('should fail if redemption amount is greater than collateral amount', async () => {
    await assert.rejects(
      async () => {
        await redeemCollateral(TestAmounts.COLLATERAL_100_MINA);
      },
      {
        message: ZkUsdVaultErrors.INSUFFICIENT_COLLATERAL,
      }
    );
  });

  it('should fail if redemption amount would undercollateralize the vault', async () => {
    const currentCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    const currentDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    assert.strictEqual(
      currentDebt!.toBigInt() > TestAmounts.ZERO.toBigInt(),
      true
    );

    await assert.rejects(
      async () => {
        await redeemCollateral(currentCollateral!);
      },
      {
        message: ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW,
      }
    );
  });

  it('should track collateral correctly after multiple redemptions', async () => {
    const initialCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();

    // Perform multiple small redemptions
    for (let i = 0; i < 3; i++) {
      await redeemCollateral(TestAmounts.COLLATERAL_1_MINA);
    }

    const finalCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    assert.deepStrictEqual(
      finalCollateral,
      initialCollateral?.sub(TestAmounts.COLLATERAL_1_MINA.mul(3))
    );
  });

  it('Should fail if the price feed is in emergency mode', async () => {
    await testHelper.stopTheProtocol();

    await assert.rejects(
      async () => {
        await transaction(testHelper.agents.alice.keys, async () => {
          await testHelper.engine.contract.redeemCollateral(
            testHelper.agents.alice.vault!.publicKey,
            TestAmounts.COLLATERAL_1_MINA
          );
        });
      },
      (err: any) => {
        assert.match(err.message, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
        return true;
      }
    );
  });

  it('Should allow redeeming if the price feed is resumed', async () => {
    await testHelper.resumeTheProtocol();

    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.redeemCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_1_MINA
      );
    });
  });
});
