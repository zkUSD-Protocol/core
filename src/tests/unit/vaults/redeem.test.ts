import { TestHelper, TestAmounts } from '../../test-helper.js';
import { AccountUpdate, Mina, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import { VaultErrors } from '../../../types/vault.js';
import { ZkUsdEngineErrors } from '../../../types/engine.js';

describe('zkUSD Vault Redeem Test Suite', () => {
  let th: TestHelper;
  let priceOneUsd: MinaPriceInput;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createAgents('alice', 'bob', 'charlie', 'rewards');

    //deploy alice's vault
    await th.createVaults('alice', 'bob');

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
      { name: 'Redeem Test Suite: Alice deposits 100 Mina' }
    );

    //Alice mints 5 zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Redeem Test Suite: Alice mints 5 zkUSD' }
    );
  });

  const redeemCollateral = async (amount: UInt64, shouldPrintTx = false) => {
    try {
      const txResult = await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.redeemCollateral(
            th.agents.alice.vault!.publicKey,
            amount,
            priceOneUsd
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
    const initialCollateral = (await th.retrieveVault('alice')).state
      .collateralAmount;
    const aliceBalanceBefore = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    await redeemCollateral(TestAmounts.COLLATERAL_1_MINA);

    const finalCollateral = (await th.retrieveVault('alice')).state
      .collateralAmount;
    const aliceBalanceAfter = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
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
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'RedeemCollateral');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
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
    const aliceBalanceBefore = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    await assert.rejects(
      async () => {
        await redeemCollateral(TestAmounts.ZERO);
      },
      (err: any) => {
        return err.message.includes(VaultErrors.AMOUNT_ZERO);
      }
    );

    const aliceBalanceAfter = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );
    assert.deepStrictEqual(aliceBalanceAfter, aliceBalanceBefore);
  });

  it('should fail if the user tries to send Mina from the engine without proof', async () => {
    const totalDepositedCollateral =
      await th.engine.contract.getTotalDepositedCollateral();

    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            let au = AccountUpdate.createSigned(
              th.networkKeys.engine.publicKey
            );
            au.send({
              to: th.agents.alice.keys.publicKey,
              amount: totalDepositedCollateral,
            });
          },
          {
            name: 'Redeem Test Suite: Alice tries to send Mina from the engine without proof',
            extraSigners: [th.networkKeys.engine.privateKey],
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
        await th.includeTx(
          th.agents.bob.keys,
          async () => {
            await th.engine.contract.redeemCollateral(
              th.agents.alice.vault!.publicKey,
              TestAmounts.COLLATERAL_1_MINA,
              priceOneUsd
            );
          },
          { name: 'Redeem Test Suite: Bob tries to redeem collateral' }
        );
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
      (err: any) => {
        return err.message.includes(VaultErrors.INSUFFICIENT_COLLATERAL);
      }
    );
  });

  it('should fail if redemption amount would undercollateralize the vault', async () => {
    const vault = await th.retrieveVault('alice');
    const currentCollateral = vault.state.collateralAmount;
    const currentDebt = vault.state.debtAmount;

    assert.strictEqual(
      currentDebt!.toBigInt() > TestAmounts.ZERO.toBigInt(),
      true
    );

    await assert.rejects(
      async () => {
        await redeemCollateral(currentCollateral!);
      },
      (err: any) => {
        return err.message.includes(VaultErrors.HEALTH_FACTOR_TOO_LOW);
      }
    );
  });

  it('should track collateral correctly after multiple redemptions', async () => {
    const initialCollateral = (await th.retrieveVault('alice')).state
      .collateralAmount;

    // Perform multiple small redemptions
    for (let i = 0; i < 3; i++) {
      await redeemCollateral(TestAmounts.COLLATERAL_1_MINA);
    }

    const finalCollateral = (await th.retrieveVault('alice')).state
      .collateralAmount;
    assert.deepStrictEqual(
      finalCollateral,
      initialCollateral?.sub(TestAmounts.COLLATERAL_1_MINA.mul(3))
    );
  });

  it('Should fail if the price feed is in emergency mode', async () => {
    await th.stopTheProtocol();

    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.redeemCollateral(
              th.agents.alice.vault!.publicKey,
              TestAmounts.COLLATERAL_1_MINA,
              priceOneUsd
            );
          },
          {
            name: 'Redeem Test Suite: Alice tries to redeem collateral in emergency mode',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
        return true;
      }
    );
  });

  it('Should allow redeeming if the price feed is resumed', async () => {
    await th.resumeTheProtocol();

    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.redeemCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_1_MINA,
          priceOneUsd
        );
      },
      {
        name: 'Redeem Test Suite: Alice redeems collateral after protocol resume',
      }
    );
  });
});
