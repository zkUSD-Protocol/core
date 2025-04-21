import { TestHelper, TestAmounts } from '../../test-helper.js';
import { AccountUpdate, Field, Permissions, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import { Vault as MkVault, VaultErrors } from '../../../system/vault.js';
import { ZkUsdEngineErrors } from '../../../system/engine.js';

describe('zkUSD Vault Liquidation Test Suite', () => {
  let th: TestHelper<'local'>;
  let priceTwoUsd: MinaPriceInput;
  let priceOneUsd: MinaPriceInput;
  let priceFiftyCent: MinaPriceInput;
  let priceFourtyCent: MinaPriceInput;
  let priceTwentyFiveCent: MinaPriceInput;

  let Vault: ReturnType<typeof MkVault>;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();

    await th.createLocalAgents('alice', 'bob', 'charlie', 'dave', 'rewards');

    //Deploy a fresh vault
    await th.createVaults('alice', 'bob', 'charlie', 'dave');

    Vault = MkVault(await th.engine.contract.getVaultParams());

    // Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'Liquidation Test Suite: Alice deposits 100 Mina' }
    );
    priceTwoUsd = await th.getMinaPriceInput(TestAmounts.PRICE_2_USD);
    priceOneUsd = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
    priceTwentyFiveCent = await th.getMinaPriceInput(TestAmounts.PRICE_25_CENT);
    priceFiftyCent = await th.getMinaPriceInput(TestAmounts.PRICE_50_CENT);
    priceFourtyCent = await th.getMinaPriceInput(TestAmounts.PRICE_40_CENT);
    // Bob deposits 900 Mina
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.bob.vault!.publicKey,
          TestAmounts.COLLATERAL_900_MINA
        );
      },
      { name: 'Liquidation Test Suite: Bob deposits 900 Mina' }
    );

    // Alice mint 30 zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_30_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Liquidation Test Suite: Alice mint 30 zkUSD' }
    );

    //Bob mint 100 zkUSD
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.bob.vault!.publicKey,
          TestAmounts.DEBT_100_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Liquidation Test Suite: Bob mint 100 zkUSD' }
    );
  });

  it('should fail if vault is sufficiently collateralized', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.bob.keys,
          async () => {
            await th.engine.contract.liquidate(
              th.agents.alice.vault!.publicKey,
              priceOneUsd
            );
          },
          {
            name: 'Liquidation Test Suite: Bob attempts to liquidate Alice vault',
          }
        );
      },
      (err: any) => {
        return err.message.includes(VaultErrors.HEALTH_FACTOR_TOO_HIGH);
      }
    );
  });

  it('should fail liquidation if liquidator does not have sufficent zkUsd', async () => {
    //Price drops to 0.25

    const newPrice = await th.getMinaPriceInput(TestAmounts.PRICE_25_CENT);

    //Bob transfers 1 zkUSD to Charlie
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.token.contract.transfer(
          th.agents.bob.keys.publicKey,
          th.agents.charlie.keys.publicKey,
          TestAmounts.DEBT_1_ZKUSD
        );
      },
      { name: 'Liquidation Test Suite: Bob transfers 1 zkUSD to Charlie' }
    );

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.charlie.keys,
        async () => {
          await th.engine.contract.liquidate(
            th.agents.alice.vault!.publicKey,
            newPrice
          );
        },
        {
          name: 'Liquidation Test Suite: Charlie attempts to liquidate Alice vault without sufficient zkUSD',
        }
      );
    }, /Overflow/i);
  });

  it('should fail liquidation if liquidator does not have receive permissions', async () => {
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        let au = AccountUpdate.create(th.agents.bob.keys.publicKey);
        let permissions = Permissions.default();
        permissions.receive = Permissions.impossible();
        au.account.permissions.set(permissions);
        AccountUpdate.attachToTransaction(au);
        au.requireSignature();
      },
      {
        name: 'Liquidation Test Suite: Bob sets receive permissions to impossible',
      }
    );

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.bob.keys,
        async () => {
          await th.engine.contract.liquidate(
            th.agents.alice.vault!.publicKey,
            priceTwentyFiveCent
          );
        },
        {
          name: 'Liquidation Test Suite: Bob attempts to liquidate Alice vault without receive permissions',
        }
      );
    }, /Update_not_permitted_balance/i);
  });

  it('should allow liquidation of vault if it is undercollateralized', async () => {
    // But the alice vault is still undercollateralized

    //Reset bobs permissions
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        let au = AccountUpdate.create(th.agents.bob.keys.publicKey);
        let permissions = Permissions.default();
        au.account.permissions.set(permissions);
        AccountUpdate.attachToTransaction(au);
        au.requireSignature();
      },
      { name: 'Liquidation Test Suite: Bob resets permissions to default' }
    );

    let vault = await th.retrieveAgentVaultState('alice');
    const aliceVaultCollateralPreLiq = vault.collateralAmount;
    const aliceVaultDebtPreLiq = vault.debtAmount;
    const bobZkUsdBalancePreLiq = await th.token.contract.getBalanceOf(
      th.agents.bob.keys.publicKey
    );
    const bobMinaBalancePreLiq = th.mina.Mina.getBalance(
      th.agents.bob.keys.publicKey
    );
    const aliceZkUsdBalancePreLiq = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );
    const aliceMinaBalancePreLiq = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.liquidate(
          th.agents.alice.vault!.publicKey,
          priceFourtyCent
        );
      },
      { name: 'Liquidation Test Suite: Bob liquidates Alice vault' }
    );

    vault = await th.retrieveAgentVaultState('alice');
    const aliceVaultCollateralPostLiq = vault.collateralAmount;
    const aliceVaultDebtPostLiq = vault.debtAmount;
    const bobZkUsdBalancePostLiq = await th.token.contract.getBalanceOf(
      th.agents.bob.keys.publicKey
    );
    const bobMinaBalancePostLiq = th.mina.Mina.getBalance(
      th.agents.bob.keys.publicKey
    );
    const aliceZkUsdBalancePostLiq = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );
    const aliceMinaBalancePostLiq = th.mina.Mina.getBalance(
      th.agents.alice.keys.publicKey
    );

    assert.equal(
      Vault.LIQUIDATION_BONUS_RATIO.equals(Field.from(110)).toBoolean(),
      true
    );

    assert.deepStrictEqual(
      aliceVaultCollateralPostLiq,
      TestAmounts.ZERO,
      "Alice vault's collateral should be 0 after liquidation"
    );
    assert.deepStrictEqual(
      aliceVaultDebtPostLiq,
      TestAmounts.ZERO,
      "Alice vault's debt should be 0 after liquidation"
    );

    const bobdiff = bobMinaBalancePostLiq.sub(bobMinaBalancePreLiq);
    const aliceDiff = aliceMinaBalancePostLiq.sub(aliceMinaBalancePreLiq);

    // total collateral returned should be equal to the collateral in the vault preliq
    assert.deepStrictEqual(
      bobdiff.add(aliceDiff),
      aliceVaultCollateralPreLiq,
      'Total collateral returned should be equal to the collateral in the vault preliq'
    );

    const ratio = UInt64.Unsafe.fromField(Vault.LIQUIDATION_BONUS_RATIO);

    // bob collateral should be equal to the debt value of collateral + liquidation bonus,
    // which is defined by ratio, e.g. ratio 110 is 10% bonus
    const collateralValue = aliceVaultDebtPreLiq!.value
      .mul(Field.from(1e9))
      .div(
        priceFourtyCent.proof.publicOutput.minaPrice.priceNanoUSD.toBigInt()
      );
    const valueWithLiquidationBonus = UInt64.Unsafe.fromField(
      collateralValue.mul(ratio.value).div(Field.from(100))
    );

    assert.deepStrictEqual(
      bobZkUsdBalancePostLiq,
      bobZkUsdBalancePreLiq.sub(aliceVaultDebtPreLiq!),
      'Bob should have the paid debt removed from his zkUSD balance'
    );
    assert.deepStrictEqual(
      bobMinaBalancePostLiq,
      bobMinaBalancePreLiq.add(valueWithLiquidationBonus),
      'Bob should have received bought collateral plus the liquidation bonus'
    );
    assert.deepStrictEqual(
      aliceZkUsdBalancePostLiq,
      aliceZkUsdBalancePreLiq,
      'Alice private zkUSD should not have changed.'
    );
    // Add check for Alice's remaining collateral
    assert.deepStrictEqual(
      aliceMinaBalancePostLiq,
      aliceMinaBalancePreLiq.add(
        aliceVaultCollateralPreLiq!.sub(valueWithLiquidationBonus)
      ),
      'Alice should have received the remaining collateral after liquidation bonus'
    );
  });

  it('should emit the Liquidate event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'Liquidate');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
    );
    assert.strictEqual(
      // @ts-ignore
      latestEvent.event.data.liquidator.toBase58(),
      th.agents.bob.keys.publicKey.toBase58()
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralLiquidated,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtRepaid,
      TestAmounts.DEBT_30_ZKUSD
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.minaPrice,
      TestAmounts.PRICE_40_CENT
    );
  });

  it('should give all collateral to liquidator when debt value exceeds collateral + liquidation bonus', async () => {
    // Setup: Dave deposits 100 MINA and mints 50 zkUSD
    await th.includeTx(
      th.agents.dave.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.dave.vault!.publicKey,
          TestAmounts.COLLATERAL_105_MINA
        );
      },
      { name: 'Liquidation Test Suite: Dave deposits 105 Mina' }
    );

    await th.includeTx(
      th.agents.dave.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.dave.vault!.publicKey,
          TestAmounts.DEBT_50_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Liquidation Test Suite: Dave mints 50 zkUSD' }
    );

    // Price drops to 0.50, making the vault eligible for liquidation
    // At this price:
    // - 100 MINA collateral = $50
    // - 50 zkUSD debt = $50 worth of MINA (100 MINA)
    // - With 10% bonus, liquidator should get 110 MINA
    // - Since only 105 MINA exists, liquidator gets all of it

    let vault = await th.retrieveAgentVaultState('dave');
    const daveVaultCollateralPreLiq = vault.collateralAmount;
    const daveVaultDebtPreLiq = vault.debtAmount;
    const bobZkUsdBalancePreLiq = await th.token.contract.getBalanceOf(
      th.agents.bob.keys.publicKey
    );
    const bobMinaBalancePreLiq = th.mina.Mina.getBalance(
      th.agents.bob.keys.publicKey
    );
    const daveMinaBalancePreLiq = th.mina.Mina.getBalance(
      th.agents.dave.keys.publicKey
    );

    // Bob liquidates Dave's vault
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.liquidate(
          th.agents.dave.vault!.publicKey,
          priceFiftyCent
        );
      },
      { name: 'Liquidation Test Suite: Bob liquidates Dave vault' }
    );

    vault = await th.retrieveAgentVaultState('dave');
    const daveVaultCollateralPostLiq = vault.collateralAmount;
    const daveVaultDebtPostLiq = vault.debtAmount;
    const bobZkUsdBalancePostLiq = await th.token.contract.getBalanceOf(
      th.agents.bob.keys.publicKey
    );
    const bobMinaBalancePostLiq = th.mina.Mina.getBalance(
      th.agents.bob.keys.publicKey
    );
    const daveMinaBalancePostLiq = th.mina.Mina.getBalance(
      th.agents.dave.keys.publicKey
    );

    // Verify vault is cleared
    assert.deepStrictEqual(
      daveVaultCollateralPostLiq,
      TestAmounts.ZERO,
      "Dave's vault collateral should be 0 after liquidation"
    );
    assert.deepStrictEqual(
      daveVaultDebtPostLiq,
      TestAmounts.ZERO,
      "Dave's vault debt should be 0 after liquidation"
    );

    // Verify Bob (liquidator) received all collateral
    const bobMinaDiff = bobMinaBalancePostLiq.sub(bobMinaBalancePreLiq);
    assert.deepStrictEqual(
      bobMinaDiff,
      daveVaultCollateralPreLiq,
      'Liquidator should receive all collateral when debt value exceeds collateral'
    );
    assert.deepStrictEqual(
      bobZkUsdBalancePostLiq,
      bobZkUsdBalancePreLiq.sub(daveVaultDebtPreLiq!),
      'Liquidator should have paid the debt amount in zkUSD'
    );

    // Verify Dave (owner) received nothing
    const daveMinaDiff = daveMinaBalancePostLiq.sub(daveMinaBalancePreLiq);
    assert.deepStrictEqual(
      daveMinaDiff,
      TestAmounts.ZERO,
      'Vault owner should receive nothing when debt value exceeds collateral'
    );
  });

  it('Should fail if the price feed is in emergency mode', async () => {
    // Set up Alice's vault with collateral and debt
    await th.includeTx(
      th.agents.charlie.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.charlie.vault!.publicKey,
          TestAmounts.COLLATERAL_1_MINA
        );
      },
      { name: 'Liquidation Test Suite: Charlie deposits 1 Mina' }
    );

    await th.includeTx(
      th.agents.charlie.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.charlie.vault!.publicKey,
          TestAmounts.DEBT_50_CENT_ZKUSD,
          priceTwoUsd
        );
      },
      { name: 'Liquidation Test Suite: Charlie mints 50 zkUSD' }
    );

    // Drop price to make vault eligible for liquidation

    await th.stopTheProtocol();

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.bob.keys,
        async () => {
          await th.engine.contract.liquidate(
            th.agents.charlie.vault!.publicKey,
            priceTwentyFiveCent
          );
        },
        {
          name: 'Liquidation Test Suite: Bob attempts to liquidate Charlie vault',
        }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
  });
});
