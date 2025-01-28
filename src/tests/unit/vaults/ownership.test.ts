import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate } from 'o1js';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';

describe('zkUSD Vault Ownership Test Suite', () => {
  let th: TestHelper;
  let priceOneUsd: MinaPriceInput;
  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createAgents(['alice', 'bob', 'charlie']);
    await th.createVaults(['alice']);

    priceOneUsd = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    // Alice deposits initial collateral
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      { name: 'Ownership Test Suite: Alice deposits initial collateral' }
    );

    // Alice mints some zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Ownership Test Suite: Alice mints some zkUSD' }
    );
  });

  it('should allow the owner to transfer ownership', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(th.agents.alice.keys.publicKey, 1);
        await th.engine.contract.updateVaultOwner(
          th.agents.alice.vault!.publicKey,
          th.agents.bob.keys.publicKey
        );
      },
      { name: 'Ownership Test Suite: Alice transfers ownership to Bob' }
    );

    // Verify the new owner is set correctly
    const vaultOwner = (await th.retrieveVault('alice')).state.owner; //
    (await th.retrieveVault('alice')).state.owner;
    assert.deepStrictEqual(
      vaultOwner?.toBase58(),
      th.agents.bob.keys.publicKey.toBase58()
    );
  });

  it('should emit the VaultOwnerUpdated event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'VaultOwnerUpdated');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      th.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.previousOwner.toBase58(),
      th.agents.alice.keys.publicKey.toBase58()
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.newOwner.toBase58(),
      th.agents.bob.keys.publicKey.toBase58()
    );
  });

  it('should allow the new owner to perform vault operations', async () => {
    // Bob (new owner) should be able to deposit collateral
    await th.includeTx(th.agents.bob.keys, async () => {
      await th.engine.contract.depositCollateral(
        th.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_50_MINA
      );
    });

    // Bob should be able to mint zkUSD
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      },
      { name: 'Ownership Test Suite: Bob mints zkUSD' }
    );

    const vault = await th.retrieveVault('alice');
    const collateralAmount = vault.state.collateralAmount;
    const debtAmount = vault.state.debtAmount;

    assert.deepStrictEqual(
      collateralAmount,
      TestAmounts.COLLATERAL_100_MINA.add(TestAmounts.COLLATERAL_50_MINA)
    );
    assert.deepStrictEqual(
      debtAmount,
      TestAmounts.DEBT_5_ZKUSD.add(TestAmounts.DEBT_5_ZKUSD)
    );
  });

  it('should prevent the previous owner from performing vault operations', async () => {
    // Alice (previous owner) should not be able to deposit collateral
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.depositCollateral(
              th.agents.alice.vault!.publicKey,
              TestAmounts.COLLATERAL_50_MINA
            );
          },
          { name: 'Ownership Test Suite: Alice attempts to deposit collateral' }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );

    // Alice should not be able to mint zkUSD
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD,
              priceOneUsd
            );
          },
          { name: 'Ownership Test Suite: Alice attempts to mint zkUSD' }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );
  });

  it('should prevent non-owners from transferring ownership', async () => {
    // Charlie (never an owner) should not be able to transfer ownership
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.charlie.keys,
          async () => {
            await th.engine.contract.updateVaultOwner(
              th.agents.alice.vault!.publicKey,
              th.agents.charlie.keys.publicKey
            );
          },
          {
            name: 'Ownership Test Suite: Charlie attempts to transfer ownership',
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );

    // Alice (previous owner) should not be able to transfer ownership
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.updateVaultOwner(
              th.agents.alice.vault!.publicKey,
              th.agents.alice.keys.publicKey
            );
          },
          { name: 'Ownership Test Suite: Alice attempts to transfer ownership' }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );
  });

  it('should allow multiple ownership transfers', async () => {
    // Bob transfers ownership to Charlie
    await th.includeTx(
      th.agents.bob.keys,
      async () => {
        AccountUpdate.fundNewAccount(th.agents.bob.keys.publicKey, 1);
        await th.engine.contract.updateVaultOwner(
          th.agents.alice.vault!.publicKey,
          th.agents.charlie.keys.publicKey
        );
      },
      { name: 'Ownership Test Suite: Bob transfers ownership to Charlie' }
    );

    // Verify Charlie is the new owner
    let vaultOwner = (await th.retrieveVault('alice')).state.owner;
    assert.deepStrictEqual(
      vaultOwner?.toBase58(),
      th.agents.charlie.keys.publicKey.toBase58()
    );

    // Charlie transfers ownership back to Alice
    await th.includeTx(
      th.agents.charlie.keys,
      async () => {
        await th.engine.contract.updateVaultOwner(
          th.agents.alice.vault!.publicKey,
          th.agents.alice.keys.publicKey
        );
      },
      {
        name: 'Ownership Test Suite: Charlie transfers ownership back to Alice',
      }
    );

    // Verify Alice is the owner again
    vaultOwner = (await th.retrieveVault('alice')).state.owner;
    assert.deepStrictEqual(
      vaultOwner?.toBase58(),
      th.agents.alice.keys.publicKey.toBase58()
    );
  });
});
