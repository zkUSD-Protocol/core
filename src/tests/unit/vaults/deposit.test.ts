import { TestHelper, TestAmounts } from '../../test-helper.js';
import { UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { VaultErrors } from '../../../system/vault.js';

describe('zkUSD Vault Deposit Test Suite', () => {
  let th: TestHelper<'local'>;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice', 'bob');

    //deploy alice's vault
    await th.createVaults('alice');
  });

  it('should allow deposits', async () => {
    const aliceBalanceBeforeDeposit = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: `Deposit Test Suite: Alice deposits 100 Mina` }
    );

    const vault = await th.retrieveAgentVaultState('alice');

    const aliceBalanceAfterDeposit = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(
      vault.collateralAmount,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(vault.debtAmount, TestAmounts.ZERO);
    assert.deepStrictEqual(
      aliceBalanceAfterDeposit,
      aliceBalanceBeforeDeposit.sub(TestAmounts.COLLATERAL_100_MINA)
    );
  });

  it('should emit the DepositCollateral event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'DepositCollateral');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
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
    const engineBalanceBeforeDeposit = th.mina.Mina.getBalance(
      th.engine.contract.address
    );

    await th.includeTx(th.agents.alice.keys, async () => {
      await th.engine.contract.depositCollateral(
        th.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    const engineBalanceAfterDeposit = th.mina.Mina.getBalance(
      th.engine.contract.address
    );

    assert.deepStrictEqual(
      engineBalanceAfterDeposit,
      engineBalanceBeforeDeposit.add(TestAmounts.COLLATERAL_100_MINA)
    );
  });

  it('should track the total collateral deposited', async () => {
    const totalCollateralDeposited =
      await th.engine.contract.getTotalDepositedCollateral();

    assert.deepStrictEqual(
      totalCollateralDeposited,
      TestAmounts.COLLATERAL_200_MINA
    );
  });

  it('should fail if deposit amount is 0', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.depositCollateral(
            th.agents.alice.vault!.publicKey,
            TestAmounts.ZERO
          );
        },
        { name: `Deposit Test Suite: Alice attempts to deposit 0 Mina` }
      );
    }, new RegExp(VaultErrors.AMOUNT_ZERO));
  });

  it('should fail if deposit amount is greater than balance', async () => {
    const aliceBalance = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.depositCollateral(
            th.agents.alice.vault!.publicKey,
            aliceBalance.add(1)
          );
        },
        {
          name: `Deposit Test Suite: Alice attempts to deposit more than balance`,
        }
      );
    });
  });

  it('should fail if deposit amount is negative', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.depositCollateral(
            th.agents.alice.vault!.publicKey,
            UInt64.from(-1)
          );
        },
        {
          name: `Deposit Test Suite: Alice attempts to deposit negative amount`,
        }
      );
    });
  });

  it('should fail if depositer is not the owner', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.bob.keys,
        async () => {
          await th.engine.contract.depositCollateral(
            th.agents.alice.vault!.publicKey,
            TestAmounts.COLLATERAL_100_MINA
          );
        },
        { name: `Deposit Test Suite: Bob attempts to deposit to Alice vault` }
      );
    }, /Field.assertEquals()/i);
  });

  it('should track total deposits correctly across multiple transactions', async () => {
    const initialVault = await th.retrieveAgentVaultState('alice');

    // Make multiple deposits
    for (let i = 0; i < 3; i++) {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.depositCollateral(
            th.agents.alice.vault!.publicKey,
            TestAmounts.COLLATERAL_1_MINA
          );
        },
        {
          name: `Deposit Test Suite: Alice deposits 1 Mina (multiple deposits test ${
            i + 1
          }/3)`,
        }
      );
    }
    const finalVault = await th.retrieveAgentVaultState('alice');
    assert.deepStrictEqual(
      finalVault.collateralAmount,
      initialVault.collateralAmount?.add(TestAmounts.COLLATERAL_1_MINA.mul(3))
    );
  });
});
