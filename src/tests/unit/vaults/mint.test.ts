import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import { AccountUpdate, UInt64 } from 'o1js';
import { Vault, VaultErrors } from '../../../system/vault.js';
import { ZkUsdEngineErrors } from '../../../system/engine.js';

describe('zkUSD Vault Mint Test Suite', () => {
  let th: TestHelper<'local'>;
  let oneUsdPrice: MinaPriceInput;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice', 'bob');

    //deploy alice's vault
    await th.createVaults('alice');

    //Alice deposits 100 Mina
    await th.includeTx(th.agents.alice.keys, async () => {
      await th.engine.contract.depositCollateral(
        th.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    oneUsdPrice = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
  });

  it('should allow alice to mint zkUSD', async () => {
    await th.includeTx(th.agents.alice.keys, async () => {
      await th.engine.contract.mintZkUsd(
        th.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_5_ZKUSD,
        oneUsdPrice
      );
    });

    const aliceBalance = await th.token.contract.getBalanceOf(
      th.agents.alice.keys.publicKey
    );

    const debtAmount = (await th.retrieveAgentVaultState('alice')).debtAmount;

    assert.deepStrictEqual(debtAmount, TestAmounts.DEBT_5_ZKUSD);
    assert.deepStrictEqual(aliceBalance, TestAmounts.DEBT_5_ZKUSD);
  });

  it('should emit the MintZkUsd event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'MintZkUsd');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.amountMinted,
      TestAmounts.DEBT_5_ZKUSD
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralAmount,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtAmount,
      TestAmounts.DEBT_5_ZKUSD
    );
  });

  it('should track total debt correctly across multiple mint operations', async () => {
    const initialDebt = (await th.retrieveAgentVaultState('alice')).debtAmount;

    // Perform multiple small mints
    for (let i = 0; i < 3; i++) {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_1_ZKUSD,
            oneUsdPrice
          );
        },
        {
          name: `Mint Test Suite: Alice mints 1 zkUSD (multiple mints test ${
            i + 1
          }/3)`,
        }
      );
    }

    const finalDebt = (await th.retrieveAgentVaultState('alice')).debtAmount;
    assert.deepStrictEqual(
      finalDebt,
      initialDebt?.add(TestAmounts.DEBT_1_ZKUSD.mul(3))
    );
  });

  it('should fail if mint amount is zero', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.ZERO,
              oneUsdPrice
            );
          },
          {
            name: 'Mint Test Suite: Alice attempts to mint 0 zkUSD - should fail',
          }
        );
      },
      (err: any) => {
        return err.message.includes(VaultErrors.AMOUNT_ZERO);
      }
    );
  });

  it('should fail if mint amount is negative', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            UInt64.from(-1),
            oneUsdPrice
          );
        },
        {
          name: 'Mint Test Suite: Alice attempts to mint negative zkUSD - should fail',
        }
      );
    });
  });

  it('should fail if the minter is not the owner of the vault', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.bob.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD,
              oneUsdPrice
            );
          },
          {
            name: 'Mint Test Suite: Bob attempts to mint zkUSD for Alice vault - should fail',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );
  });

  it('should fail if the health factor is too low', async () => {
    const LARGE_ZKUSD_AMOUNT = UInt64.from(1000e9); // Very large amount to ensure health factor violation

    await assert.rejects(
      async () => {
        await th.includeTx(th.agents.alice.keys, async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            LARGE_ZKUSD_AMOUNT,
            oneUsdPrice
          );
        });
      },
      (err: any) => {
        return err.message.includes(VaultErrors.HEALTH_FACTOR_TOO_LOW);
      }
    );
  });

  it('should maintain correct health factor after multiple mint operations', async () => {
    const au = AccountUpdate.create(
      th.agents.alice.vault!.publicKey,
      th.engine.contract.deriveTokenId()
    );

    let vault: Vault = Vault.getAndRequireEquals(au);

    const initialCollateral = vault.state.collateralAmount;
    let currentDebt = vault.state.debtAmount;

    // Mint multiple times while checking health factor
    for (let i = 0; i < 3; i++) {
      const healthFactor = vault.calculateHealthFactor(
        initialCollateral!,
        currentDebt!.add(TestAmounts.DEBT_1_ZKUSD),
        oneUsdPrice.proof.publicOutput.minaPrice
      );

      // Only mint if health factor would remain above minimum
      if (healthFactor!.greaterThanOrEqual(Vault.MIN_HEALTH_FACTOR)) {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_1_ZKUSD,
              oneUsdPrice
            );
          },
          {
            name: `Mint Test Suite: Health Factor Check - Alice mints 1 zkUSD (multiple mints test ${
              i + 1
            }/3)`,
          }
        );

        const au2 = AccountUpdate.create(
          th.agents.alice.vault!.publicKey,
          th.engine.contract.deriveTokenId()
        );

        vault = Vault.getAndRequireEquals(au2);
        currentDebt = currentDebt?.add(TestAmounts.DEBT_1_ZKUSD);
      }
    }

    const finalHealthFactor = vault.calculateHealthFactor(
      initialCollateral!,
      currentDebt!,
      oneUsdPrice.proof.publicOutput.minaPrice
    );

    assert.strictEqual(
      finalHealthFactor!
        .greaterThanOrEqual(Vault.MIN_HEALTH_FACTOR)
        .toBoolean(),
      true
    );
  });

  it('should not allow minting from calling the token contract directly', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.token.contract.mint(
              th.agents.alice.keys.publicKey,
              TestAmounts.DEBT_5_ZKUSD
            );
          },
          {
            name: 'Mint Test Suite: Alice attempts to mint zkUSD from token contract - should fail',
          }
        );
      },
      (err: any) => {
        assert.match(
          err.message,
          /Account_app_state_precondition_unsatisfied/i
        );
        return true;
      }
    );
  });

  it('Should fail if the engine is halted', async () => {
    await th.stopTheProtocol();

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
            name: 'Mint Test Suite: Alice attempts to mint zkUSD while engine is halted - should fail',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
        return true;
      }
    );
  });

  it('Should allow minting if the price feed is resumed', async () => {
    await th.resumeTheProtocol();

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
        name: 'Mint Test Suite: Alice attempts to mint zkUSD while price feed is resumed - should succeed',
      }
    );
  });
});
