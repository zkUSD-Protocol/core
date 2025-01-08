import { TestHelper, TestAmounts } from '../unit-test-helper.js';
import { Field, Mina, UInt64 } from 'o1js';
import { ZkUsdVaultErrors } from '../../../contracts/zkusd-vault.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Vault Deposit Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice', 'bob']);

    //deploy alice's vault
    await testHelper.createVaults(['alice']);
  });

  it('should allow deposits', async () => {
    const aliceBalanceBeforeDeposit = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    const aliceVault = testHelper.agents.alice.vault;

    const collateralAmount =
      await aliceVault?.contract.collateralAmount.fetch();
    const debtAmount = await aliceVault?.contract.debtAmount.fetch();

    const aliceBalanceAfterDeposit = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(collateralAmount, TestAmounts.COLLATERAL_100_MINA);
    assert.deepStrictEqual(debtAmount, TestAmounts.ZERO);
    assert.deepStrictEqual(
      aliceBalanceAfterDeposit,
      aliceBalanceBeforeDeposit.sub(TestAmounts.COLLATERAL_100_MINA)
    );
  });

  it('should emit the DepositCollateral event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'DepositCollateral');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.amountDeposited,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralAmount,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtAmount,
      TestAmounts.ZERO
    );
  });

  it('should have added the collateral to the balance of the engine contract', async () => {
    const engineBalanceBeforeDeposit = Mina.getBalance(
      testHelper.engine.contract.address
    );

    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    const engineBalanceAfterDeposit = Mina.getBalance(
      testHelper.engine.contract.address
    );

    assert.deepStrictEqual(
      engineBalanceAfterDeposit,
      engineBalanceBeforeDeposit.add(TestAmounts.COLLATERAL_100_MINA)
    );
  });

  it('should track the total collateral deposited', async () => {
    const totalCollateralDeposited =
      await testHelper.engine.contract.getTotalDepositedCollateral();

    assert.deepStrictEqual(
      totalCollateralDeposited,
      TestAmounts.COLLATERAL_200_MINA
    );
  });

  it('should fail if deposit amount is 0', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.ZERO
        );
      });
    }, new RegExp(ZkUsdVaultErrors.AMOUNT_ZERO));
  });

  it('should fail if deposit amount is greater than balance', async () => {
    const aliceBalance = Mina.getBalance(
      testHelper.agents.alice.keys.publicKey
    );

    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          aliceBalance.add(1)
        );
      });
    });
  });

  it('should fail if deposit amount is negative', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          UInt64.from(-1)
        );
      });
    });
  });

  it('should fail if depositer is not the owner', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.bob.keys, async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      });
    }, /Field.assertEquals()/i);
  });

  it('should track total deposits correctly across multiple transactions', async () => {
    const initialCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();

    // Make multiple deposits
    for (let i = 0; i < 3; i++) {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_1_MINA
        );
      });
    }

    const finalCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    assert.deepStrictEqual(
      finalCollateral,
      initialCollateral?.add(TestAmounts.COLLATERAL_1_MINA.mul(3))
    );
  });
});
