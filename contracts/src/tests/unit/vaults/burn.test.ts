import { TestHelper, TestAmounts } from '../../test-helper.js';
import { AccountUpdate, UInt64 } from 'o1js';
import { ZkUsdVaultErrors } from '../../../contracts/zkusd-vault.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Vault Burn Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLocalChain({proofsEnabled: false});
    await testHelper.deployTokenContracts();
    await testHelper.createAgents(['alice', 'bob', 'charlie']);

    //deploy alice's vault
    await testHelper.createVaults(['alice']);

    // Alice deposits 100 Mina
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    // Alice mint 30 zkUSD
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_30_ZKUSD
      );
    });
  });

  it('should allow alice to burn zkUSD', async () => {
    const aliceStartingBalance = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.alice.keys.publicKey
    );

    const vaultStartingDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.burnZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_1_ZKUSD
      );
    });

    const vaultFinalDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
    const aliceFinalBalance = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(
      vaultFinalDebt,
      vaultStartingDebt?.sub(TestAmounts.DEBT_1_ZKUSD)
    );
    assert.deepStrictEqual(
      aliceFinalBalance,
      aliceStartingBalance.sub(TestAmounts.DEBT_1_ZKUSD)
    );
  });

  it('should emit the BurnZkUsd event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'BurnZkUsd');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.amountBurned,
      TestAmounts.DEBT_1_ZKUSD
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralAmount,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtAmount,
      TestAmounts.DEBT_30_ZKUSD.sub(TestAmounts.DEBT_1_ZKUSD)
    );
  });

  it('should fail if burn amount is zero', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.burnZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.ZERO
        );
      });
    }, new RegExp(ZkUsdVaultErrors.AMOUNT_ZERO));
  });

  it('should fail if burn amount exceeds debt', async () => {
    const currentDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.burnZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          currentDebt!.add(1)
        );
      });
    }, new RegExp(ZkUsdVaultErrors.AMOUNT_EXCEEDS_DEBT));
  });

  it('should fail if burn amount is negative', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.burnZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          UInt64.from(-1)
        );
      });
    });
  });

  it('should track debt correctly after multiple burns', async () => {
    const initialDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    // Perform multiple small burns
    for (let i = 0; i < 3; i++) {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.burnZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_10_CENT_ZKUSD
        );
      });
    }

    const finalDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
    assert.deepStrictEqual(
      finalDebt,
      initialDebt?.sub(TestAmounts.DEBT_10_CENT_ZKUSD.mul(3))
    );
  });

  it('should fail if trying to burn without sufficient zkUSD balance', async () => {
    const aliceBalance = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.alice.keys.publicKey
    );

    //Alice transfers all her zkUSD to Bob
    await transaction(testHelper.agents.alice.keys, async () => {
      AccountUpdate.fundNewAccount(testHelper.agents.alice.keys.publicKey, 1);
      await testHelper.token.contract.transfer(
        testHelper.agents.alice.keys.publicKey,
        testHelper.agents.bob.keys.publicKey,
        aliceBalance
      );
    });

    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.burnZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_10_CENT_ZKUSD
        );
      });
    });
  });
});
