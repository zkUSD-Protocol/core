import { Agent, TestAmounts, TestHelper } from '../../test-helper.js';

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate, PrivateKey, UInt64 } from 'o1js';

describe('zkUSD Lightnet - Functional Integration Test Suite', () => {
  let th: TestHelper;
  let alice: Agent;

  before(async () => {
    th = await TestHelper.initLightnetChain();
    [alice] = await th.createAgents('alice');
  });

  it('should be able to deploy contracts on Lightnet', async () => {
    await th.deployTokenContracts();
  });

  it('Should be able to fund new accounts', async () => {
    // fund newmans account
    const keys = PrivateKey.randomKeypair();
    await th.includeTx(
      alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(alice.keys.publicKey, 1);
        const au2 = AccountUpdate.createSigned(alice.keys.publicKey);
        au2.send({
          to: keys.publicKey,
          amount: TestAmounts.COLLATERAL_50_MINA,
        });
      },
      { name: 'fund_newman' }
    );
    await th.registerNewAgent('newman', { keys });
  });

  it('user should be able create a vault', async () => {
    await th.createVaults('newman');
    const newmanVault = th.mina.fetchMinaAccount(
      th.agents.newman.vault?.publicKey!,
      { tokenId: th.engine.contract.deriveTokenId(), force: true }
    );

    assert.notStrictEqual(newmanVault, null);
    assert.notStrictEqual(th.agents['newman'].vault, null);
  });

  it('user should be able to deposit', async () => {
    const newman = th.agents['newman'];
    await th.includeTx(
      newman.keys,
      async () => {
        console.log('newman vault pk', newman.vault!.publicKey.toBase58());
        await th.engine.contract.depositCollateral(
          newman.vault!.publicKey,
          UInt64.from(1e9)
        );
      },
      { name: 'newman_deposits_collateral' }
    );
  });

  it('user should be able to mint', async () => {
    const newman = th.agents['newman'];

    const price = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    await assert.doesNotReject(async () => {
      await th.includeTx(
        newman.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            newman.vault!.publicKey,
            UInt64.from(0.5e9),
            price
          );
        },
        {
          waitForIncluded: ['newman_deposits_collateral'],
          name: 'newman_mints_zkUSD',
        }
      );
    });
  });

  it('user should be able to repay', async () => {
    const newman = th.agents['newman'];

    await assert.doesNotReject(async () => {
      await th.includeTx(
        newman.keys,
        async () => {
          await th.engine.contract.burnZkUsd(
            newman.vault!.publicKey,
            UInt64.from(0.5e9)
          );
        },
        {
          name: 'newman_burns_zkUSD',
          waitForIncluded: ['newman_mints_zkUSD'],
        }
      );
    });
  });

  it(`user's vault can be liquidated`, async () => {
    const newman = th.agents['newman'];

    // assert mintTx defined
    const price = await th.getMinaPriceInput(TestAmounts.PRICE_10_USD);

    await assert.doesNotReject(async () => {
      await th.includeTx(
        newman.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            newman.vault!.publicKey,
            UInt64.from(5e9),
            price
          );
        },
        {
          name: 'newman_mints_again',
        }
      );
    });

    const newPrice = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    await assert.doesNotReject(async () => {
      await th.includeTx(
        alice.keys,
        async () => {
          AccountUpdate.fundNewAccount(alice.keys.publicKey);
          await th.engine.contract.liquidate(newman.vault!.publicKey, newPrice);
        },
        {
          name: `newman's getting liquidated`,
        }
      );
    });
  });
});
