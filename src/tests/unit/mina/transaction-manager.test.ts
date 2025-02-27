import { TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate, PrivateKey } from 'o1js';
import {
  statusIsFailed,
  statusIsFinal,
  statusIsOfKind,
  statusIsRejected,
} from '../../../transaction/status.js';
import { TransactionHandle } from '../../../transaction/manager.js';

describe('Local tests of TransactionManager', async () => {
  const helper = await TestHelper.initLocalChain();
  const txMgr = helper.txMgr;

  before(async () => {});

  it('can create a tx and await until it is included', async () => {
    const [alice, bob] = await helper.createLocalAgents('alice', 'bob');

    const txHandle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.createSigned(alice.keys.publicKey);
      au.send({
        to: bob.keys.publicKey,
        amount: 100,
      });
    });

    await txHandle.awaitIncluded();

    assert(txHandle.txStatus === 'Included');
  });

  it('can create a tx with dependencies and await until it is included', async () => {
    const [alice] = await helper.createLocalAgents('alice');

    const bob_keys = PrivateKey.randomKeypair();

    const txHandle = await txMgr.tx(
      alice.keys,
      async () => {
        const au = AccountUpdate.fundNewAccount(alice.keys.publicKey);
        au.send({
          to: bob_keys.publicKey,
          amount: 100,
        });
      },
      { name: 'alice_to_bob' }
    );
    // wait 100ms
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const tx2Handle = await txMgr.tx(
      alice.keys,
      async () => {
        const au = AccountUpdate.createSigned(bob_keys.publicKey);
        au.send({
          to: alice.keys.publicKey,
          amount: 100,
        });
      },
      {
        name: 'bob_returns',
        waitForIncluded: ['alice_to_bob'],
        extraSigners: [bob_keys.privateKey],
      }
    );

    await tx2Handle.awaitIncluded();

    assert(tx2Handle.txStatus === 'Included');
    assert(txHandle.txStatus === 'Included');

    await txHandle.awaitIncluded();
    console.log('im fine');
  });

  it('tx with dependencies will fail if a dep failed', async () => {
    const [alice] = await helper.createLocalAgents('alice');

    const bob_keys = PrivateKey.randomKeypair();

    const txHandle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.fundNewAccount(alice.keys.publicKey);
      au.send({
        to: bob_keys.publicKey,
        amount: 10000e9,
      });
    });

    const tx2Handle = await txMgr.tx(
      alice.keys,
      async () => {
        const au = AccountUpdate.createSigned(bob_keys.publicKey);
        au.send({
          to: alice.keys.publicKey,
          amount: 100,
        });
      },
      {
        name: 'bob_will_not_return',
        waitForIncluded: [txHandle],
        extraSigners: [bob_keys.privateKey],
      }
    );

    await tx2Handle.awaitStatusChange({
      until: (status) => statusIsFinal(status),
    });

    assert(statusIsRejected(txHandle.txStatus));
    assert(statusIsFailed(tx2Handle.txStatus));

    console.log(JSON.stringify(tx2Handle.txStatus, null, 2));

    console.log(
      statusIsOfKind(tx2Handle.txStatus, 'DependencyRejectedFailedOrDropped')
    );

    assert.ok(
      statusIsOfKind(tx2Handle.txStatus, 'DependencyRejectedFailedOrDropped')
    );
  });

  it('execute multiple txs from different accounts simultanously', async () => {
    const names = [
      'alice',
      'bob',
      'charlie',
      'david',
      'eve',
      'frank',
      'george',
      'harry',
      'ian',
    ];
    const agents = await helper.createLocalAgents(...names);
    // make 10
    const txHandles: TransactionHandle[] = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const txHandle = await txMgr.tx(agent.keys, async () => {
        const au = AccountUpdate.createSigned(agent.keys.publicKey);
        au.send({
          to: agents[(i + 1) % agents.length].keys.publicKey,
          amount: 100,
        });
      });
      txHandles.push(txHandle);
    }
    await Promise.all(txHandles.map((txHandle) => txHandle.awaitIncluded()));
  });

  it('execute multiple txs from mixed accounts simultanously', async () => {
    const names = ['alice', 'bob', 'charlie', 'david'];
    const agents = await helper.createLocalAgents(...names);
    // make 10
    const txHandles: TransactionHandle[] = [];

    for (let i = 0; i < agents.length; i++) {
      for (let j = 1; j < agents.length; j++) {
        if (i === j) continue;
        const sender = agents[i];
        const receiver = agents[j];
        const txHandle = await txMgr.tx(
          sender.keys,
          async () => {
            const au = AccountUpdate.createSigned(sender.keys.publicKey);
            au.send({
              to: receiver.keys.publicKey,
              amount: 100,
            });
          },
          { name: `${names[i]}_to_${names[j]}_${i}_${j}` }
        );
        txHandles.push(txHandle);
      }
      await Promise.all(txHandles.map((txHandle) => txHandle.awaitIncluded()));
    }
  });

  // TODO: this will not work because Transaction is not a class
  // but maybe a library as `ts-mockito` might help
  // or when we switch to using signing service we can test
  // the catch block in the signing promise mocking the sign service
  // describe('Testing nonceLock unlock behavior', () => {
  //   let alice: Agent;

  //   before(async () => {
  //     [alice] = await helper.createLocalAgents('alice', 'bob');
  //     // Give alice some balance if you want to ensure it can pay fees
  //     // or leave it with 0 if you want “insufficient funds” to cause an error, etc.
  //     // In local tests, you can always fund it:
  //   });

  //   it('unlocks nonceLock if transaction fails during SIGNING', async () => {
  //     // We will override the sign() method to force an error when it is called
  //     const originalSign = Transaction.prototype.sign;
  //     Transaction.prototype.sign = function () {
  //       throw new Error('Forcing sign error');
  //     };

  //     let failedTxHandle;
  //     try {
  //       failedTxHandle = await helper.tx(
  //         alice,
  //         async () => {
  //           // Create a normal AccountUpdate; the sign() call will be mocked to throw
  //           const au = AccountUpdate.createSigned(alice.keys.publicKey);
  //           au.send({
  //             to: PrivateKey.randomKeypair().publicKey,
  //             amount: 123,
  //           });
  //         },
  //         {
  //           name: 'failing-tx-sign',
  //         }
  //       );
  //       // We expect awaitIncluded() to reject because sign() threw
  //       await assert.rejects(failedTxHandle.awaitIncluded(), /Forcing sign error/);
  //       // Now the TransactionManager should have caught that error,
  //       // unlocked the nonceLock, and marked the transaction as failed.
  //       assert(statusIsFailed(failedTxHandle.txStatus));
  //     } finally {
  //       // Restore the original .sign method so it doesn't affect other tests
  //       Transaction.prototype.sign = originalSign;
  //     }

  //     // Now create a second transaction from the same account.
  //     // If the nonceLock was *not* unlocked, this transaction would hang or fail
  //     const successTxHandle = await helper.tx(
  //       alice,
  //       async () => {
  //         const au = AccountUpdate.createSigned(alice.keys.publicKey);
  //         au.send({
  //           to: PrivateKey.randomKeypair().publicKey,
  //           amount: 99,
  //         });
  //       },
  //       {
  //         name: 'subsequent-tx-after-sign-failure',
  //       }
  //     );
  //     // If we get here and can await until included, that means the nonceLock
  //     // was properly released.
  //     await successTxHandle.awaitIncluded();
  //     assert(successTxHandle.txStatus === 'Included');
  //   });

  //   it('unlocks nonceLock if transaction fails during SENDING (safeSend)', async () => {
  //     // We will override the safeSend() method to force an error when it is called
  //     const originalSafeSend = Transaction.prototype.safeSend;
  //     Transaction.prototype.safeSend = async function () {
  //       throw new Error('Forcing safeSend error');
  //     };

  //     let failedTxHandle;
  //     try {
  //       failedTxHandle = await helper.tx(
  //         alice,
  //         async () => {
  //           const au = AccountUpdate.createSigned(alice.keys.publicKey);
  //           au.send({
  //             to: PrivateKey.randomKeypair().publicKey,
  //             amount: 500,
  //           });
  //         },
  //         {
  //           name: 'failing-tx-send',
  //         }
  //       );
  //       // We expect awaitIncluded() to reject because safeSend() threw
  //       await assert.rejects(failedTxHandle.awaitIncluded(), /Forcing safeSend error/);
  //       assert(statusIsFailed(failedTxHandle.txStatus));
  //     } finally {
  //       // Restore the original .safeSend method so it doesn't affect other tests
  //       Transaction.prototype.safeSend = originalSafeSend;
  //     }

  //     // Now create a second transaction from the same account to confirm the lock is freed
  //     const successTxHandle = await helper.tx(
  //       alice,
  //       async () => {
  //         const au = AccountUpdate.createSigned(alice.keys.publicKey);
  //         au.send({
  //           to: PrivateKey.randomKeypair().publicKey,
  //           amount: 250,
  //         });
  //       },
  //       {
  //         name: 'subsequent-tx-after-send-failure',
  //       }
  //     );
  //     await successTxHandle.awaitIncluded();
  //     assert(successTxHandle.txStatus === 'Included');
  //   });
  // });
});
