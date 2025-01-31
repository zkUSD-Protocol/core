import { TestAmounts, TestHelper } from '../../test-helper.js';
import { AccountUpdate, UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { MinaPrice } from '../../../types/oracle.js';
import { Vault } from '../../../types/vault.js';

describe('zkUSD Vault Health Factor Calculations Test Suite', () => {
  let th: TestHelper;
  let price: MinaPrice;
  let vault: Vault;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice', 'bob');
    await th.createVaults('alice', 'bob');

    price = (await th.getMinaPriceInput(TestAmounts.PRICE_1_USD)).proof
      .publicOutput.minaPrice;

    await th.mina.fetchMinaAccount(th.agents.alice.vault!.publicKey, {
      tokenId: th.engine.contract.deriveTokenId(),
      force: true,
    });

    const au = AccountUpdate.create(
      th.agents.alice.vault!.publicKey,
      th.engine.contract.deriveTokenId()
    );

    vault = Vault.getAndRequireEquals(au);
  });

  describe('Health Factor Calculations', () => {
    it('should calculate health factor of 66 for 1:1 collateral to debt ratio at $1 price', async () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 1 MINA * $1 = $1 collateral value
      // $1 collateral / ($1 debt * 150%) = 0.66 = 66 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 66n);
    });

    it('should calculate health factor of 133 for 2:1 collateral to debt ratio at $1 price', async () => {
      const collateral = UInt64.from(2e9); // 2 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 2 MINA * $1 = $2 collateral value
      // $2 collateral / ($1 debt * 150%) = 1.33 = 133 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 133n);
    });

    it('should calculate health factor of 33 for 1:2 collateral to debt ratio at $1 price', async () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(2e9); // 2 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 1 MINA * $1 = $1 collateral value
      // $1 collateral / ($2 debt * 150%) = 0.33 = 33 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 33n);
    });

    it('should calculate health factor of 133 for 1:1 collateral to debt ratio at $2 price', async () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD

      const newPrice = (await th.getMinaPriceInput(TestAmounts.PRICE_2_USD))
        .proof.publicOutput.minaPrice;

      const healthFactor = vault.calculateHealthFactor(
        collateral,
        debt,
        newPrice
      );

      // 1 MINA * $2 = $2 collateral value
      // $2 collateral / ($1 debt * 150%) = 1.33 = 133 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 133n);
    });

    it('should calculate health factor of 33 for 1:1 collateral to debt ratio at $0.50 price', async () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD
      const newPrice = (await th.getMinaPriceInput(TestAmounts.PRICE_50_CENT))
        .proof.publicOutput.minaPrice;

      const healthFactor = vault.calculateHealthFactor(
        collateral,
        debt,
        newPrice
      );

      // 1 MINA * $0.50 = $0.50 collateral value
      // $0.50 collateral / ($1 debt * 150%) = 0.33 = 33 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 33n);
    });

    it('should return max UInt64 value when debt is zero', async () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(0); // 0 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      assert.strictEqual(healthFactor?.toBigInt(), UInt64.MAXINT().toBigInt());
    });

    it('should calculate health factor of 666 for large numbers', async () => {
      const collateral = UInt64.from(1000e9); // 1000 MINA
      const debt = UInt64.from(100e9); // 100 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 1000 MINA * $1 = $1000 collateral value
      // $1000 collateral / ($100 debt * 150%) = 6.66 = 666 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 666n);
    });

    it('should calculate health factor of 66 for small numbers', async () => {
      const collateral = UInt64.from(0.1e9); // 0.1 MINA
      const debt = UInt64.from(0.1e9); // 0.1 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 0.1 MINA * $1 = $0.1 collateral value
      // $0.1 collateral / ($0.1 debt * 150%) = 0.66 = 66 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 66n);
    });

    it('should calculate consistent health factors across different decimal places', async () => {
      // Test case 1: 1 MINA : 1 zkUSD
      const hf1 = vault.calculateHealthFactor(
        UInt64.from(1e9),
        UInt64.from(1e9),
        price
      );

      // Test case 2: 0.1 MINA : 0.1 zkUSD (same ratio)
      const hf2 = vault.calculateHealthFactor(
        UInt64.from(0.1e9),
        UInt64.from(0.1e9),
        price
      );

      // Test case 3: 10 MINA : 10 zkUSD (same ratio)
      const hf3 = vault.calculateHealthFactor(
        UInt64.from(10e9),
        UInt64.from(10e9),
        price
      );

      // All should be 66 as they have the same ratio
      assert.strictEqual(hf1?.toBigInt(), 66n);
      assert.strictEqual(hf2?.toBigInt(), 66n);
      assert.strictEqual(hf3?.toBigInt(), 66n);
    });

    it('should calculate health factor of 100 at exactly 150% collateralization', async () => {
      const collateral = UInt64.from(150e9); // 1.5 MINA
      const debt = UInt64.from(100e9); // 1 zkUSD

      const healthFactor = vault.calculateHealthFactor(collateral, debt, price);

      // 1.5 MINA * $1 = $1.5 collateral value
      // $1.5 collateral / ($1 debt * 150%) = 1.00 = 100 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 100n);
    });

    it('should return the correct health factor for the vault', async () => {
      const collateral = vault.state.collateralAmount;
      const debt = vault.state.debtAmount;

      const healthFactor = await th.engine.contract.getVaultHealthFactor(
        th.agents.alice.vault!.publicKey,
        price
      );

      const rawHealthFactor = vault.calculateHealthFactor(
        collateral!,
        debt!,
        price
      );
      assert.strictEqual(healthFactor?.toBigInt(), rawHealthFactor?.toBigInt());
    });

    it('should return UInt64.MAXINT() when vault has no debt', async () => {
      const healthFactor = await th.engine.contract.getVaultHealthFactor(
        th.agents.bob.vault!.publicKey,
        price
      );
      assert.strictEqual(healthFactor.toBigInt(), UInt64.MAXINT().toBigInt());
    });
  });
});
