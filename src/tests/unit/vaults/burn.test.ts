import { TestHelper, TestAmounts } from '../../test-helper.js';
import { AccountUpdate, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import { VaultErrors } from '../../../system/vault.js';

describe('zkUSD Vault Burn Test Suite', () => {
  let th: TestHelper<'local'>;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice', 'bob', 'charlie');

    //deploy alice's vault
    await th.createVaults('alice');

    const price: MinaPriceInput = await th.getMinaPriceInput(
      TestAmounts.PRICE_1_USD
    );

    // Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'Burn Test Suite: Alice deposits 100 Mina' }
    );

    // Alice mint 30 zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_30_ZKUSD,
          price
        );
      },
      { name: 'Burn Test Suite: Alice mints 30 zkUSD' }
    );
  });

  it('should allow alice to burn zkUSD', async () => {
    const aliceStartingBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    const vaultStartingState = await th.retrieveAgentVaultState('alice');

    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.burnZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_1_ZKUSD
        );
      },
      { name: 'Burn Test Suite: Alice burns 1 zkUSD' }
    );

    const vaultFinalState = await th.retrieveAgentVaultState('alice');

    const aliceFinalBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    assert.deepStrictEqual(
      vaultFinalState.debtAmount,
      vaultStartingState.debtAmount.sub(TestAmounts.DEBT_1_ZKUSD)
    );
    assert.deepStrictEqual(
      aliceFinalBalance,
      aliceStartingBalance.sub(TestAmounts.DEBT_1_ZKUSD)
    );
  });

  it('should emit the BurnZkUsd event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'BurnZkUsd');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
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
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.ZERO
          );
        },
        { name: 'Burn Test Suite: Alice burns 0 zkUSD' }
      );
    }, new RegExp(VaultErrors.AMOUNT_ZERO));
  });

  it('should fail if burn amount exceeds debt', async () => {
    const currentVault = await th.retrieveAgentVaultState('alice');

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            th.agents.alice.vault!.publicKey,
            currentVault.debtAmount.add(1)
          );
        },
        { name: 'Burn Test Suite: Alice burns more than debt' }
      );
    }, new RegExp(VaultErrors.AMOUNT_EXCEEDS_DEBT));
  });

  it('should fail if burn amount is negative', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            th.agents.alice.vault!.publicKey,
            UInt64.from(-1)
          );
        },
        { name: 'Burn Test Suite: Alice burns negative amount' }
      );
    });
  });

  it('should track debt correctly after multiple burns', async () => {
    const initialVault = await th.retrieveAgentVaultState('alice');

    // Perform multiple small burns
    for (let i = 0; i < 3; i++) {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_10_CENT_ZKUSD
          );
        },
        { name: `Burn Test Suite: Alice burns 10 cents ${i}` }
      );
    }

    const finalVault = await th.retrieveAgentVaultState('alice');

    assert.deepStrictEqual(
      finalVault.debtAmount,
      initialVault.debtAmount.sub(TestAmounts.DEBT_10_CENT_ZKUSD.mul(3))
    );
  });

  it('should fail if trying to burn without sufficient zkUSD balance', async () => {
    const aliceBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    //Alice transfers all her zkUSD to Bob
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(th.agents.alice.keys.publicKey, 1);
        await th.token.contract.transfer(
          th.agents.alice.keys.publicKey,
          th.agents.bob.keys.publicKey,
          aliceBalance
        );
      },
      { name: 'Burn Test Suite: Alice transfers all zkUSD to Bob' }
    );

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_10_CENT_ZKUSD
          );
        },
        { name: 'Burn Test Suite: Alice burns 10 cents' }
      );
    });
  });
});
