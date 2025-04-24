import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate, UInt64 } from 'o1js';

describe('zkUSD Integration - Functional - Happy Path Vault Path + Engine Updates', () => {
  let th: TestHelper<'local'>;
  let startingFee: UInt64 = UInt64.from(1e8);

  before(async () => {
    th = await TestHelper.initLightnetChain();
  });

  it('should do a transaction', async () => {
    const newAccount = await th.mina.newAccount();

    console.log('Testing Lightnet Tx');

    const txHandle = await th.tx(th.deployer, async () => {
      const au = AccountUpdate.createSigned(th.deployer.publicKey);
      au.send({
        to: newAccount.publicKey,
        amount: 1,
      });
    });

    txHandle.subscribeToLifecycle((status) => {
      console.log('DEBUG: Tx status og', status);
    });

    txHandle.subscribeToLifecycleChange((status) => {
      console.log('DEBUG: Tx status change', status);
    });

    setInterval(() => {
      console.log('DEBUG: Tx status', txHandle.txStatus);
    }, 1000);
  });
});
