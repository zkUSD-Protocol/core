import { TestHelper } from "../../test-helper.js";
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { TransactionManager, statusIsFailed, statusIsFinal, statusIsOfKind, statusIsRejected } from "../../../mina/transaction-manager.js"
import { AccountUpdate, PrivateKey } from "o1js";

describe('Local tests of TransactionManager', async () => {
  const testHelper = await TestHelper.initLocalChain();
  const txMgr = TransactionManager.new(testHelper.mina);

  before(async () => {
  });

  it('can create a tx and await until it is included', async () => {

    const [alice, bob] = await testHelper.createAgents(["alice", "bob"]);

    const txHandle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.createSigned(alice.keys.publicKey);
      au.send({
        to: bob.keys.publicKey,
        amount: 100,
      });
    });

    const includedTx = await txHandle.awaitIncluded();

    assert(txHandle.txStatus === 'Included');
    assert(includedTx.status === 'included');

  })

  it('can create a tx with dependencies and await until it is included', async () => {

    const [alice] = await testHelper.createAgents(["alice"]);

    const bob_keys = PrivateKey.randomKeypair();

    const txHandle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.fundNewAccount(alice.keys.publicKey);
      au.send({
        to: bob_keys.publicKey,
        amount: 100,
      });
    }, { name: 'alice_to_bob' });

    const tx2Handle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.createSigned(bob_keys.publicKey);
      au.send({
        to: alice.keys.publicKey,
        amount: 100,
      });
    },
      {
        name: "bob_returns",
        waitForIncluded: ['alice_to_bob'],
        extraSigners: [bob_keys.privateKey]
      });

    const includedTx = await tx2Handle.awaitIncluded();

    assert(tx2Handle.txStatus === 'Included');
    assert(txHandle.txStatus === 'Included');
    assert(includedTx.status === 'included');
  })

  it('tx with dependencies will fail if a dep failed', async () => {

    const [alice] = await testHelper.createAgents(["alice"]);

    const bob_keys = PrivateKey.randomKeypair();

    const txHandle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.fundNewAccount(alice.keys.publicKey);
      au.send({
        to: bob_keys.publicKey,
        amount: 10000e9,
      });
    });

    const tx2Handle = await txMgr.tx(alice.keys, async () => {
      const au = AccountUpdate.createSigned(bob_keys.publicKey);
      au.send({
        to: alice.keys.publicKey,
        amount: 100,
      });
    },
      {
        name: "bob_will_not_return",
        waitForIncluded: [txHandle],
        extraSigners: [bob_keys.privateKey]
      });

    await tx2Handle.awaitStatusChange({ until: status => statusIsFinal(status) });

    assert(statusIsRejected(txHandle.txStatus));
    assert(statusIsFailed(tx2Handle.txStatus));
    assert(statusIsOfKind(tx2Handle.txStatus, "DependencyRejectedFailedOrDropped"));

  })

  it('execute multiple txs from different accounts simultanously', async () => {
    const names = ['alice', 'bob', 'charlie', 'david', 'eve', 'frank', 'george', 'harry', 'ian'];
    const agents = await testHelper.createAgents(names);
    // make 10
    const txHandles = [];

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
    await Promise.all(txHandles.map(txHandle => txHandle.awaitIncluded()));
  })

  it('execute multiple txs from mixed accounts simultanously', async () => {
    const names = ['alice', 'bob', 'charlie','david'];
    const agents = await testHelper.createAgents(names);
    // make 10
    const txHandles = [];

    for (let i = 0; i < agents.length; i++) {
      for(let j = 1; j < agents.length; j++) {
        if(i===j) continue;
        const sender = agents[i];
        const receiver = agents[j];
        const txHandle = await txMgr.tx(sender.keys, async () => {
          const au = AccountUpdate.createSigned(sender.keys.publicKey);
          au.send({
            to: receiver.keys.publicKey,
            amount: 100,
          });
        }, { name: `${names[i]}_to_${names[j]}_${i}_${j}`});
        txHandles.push(txHandle);
      }
    await Promise.all(txHandles.map(txHandle => txHandle.awaitIncluded()));
    }})
});
