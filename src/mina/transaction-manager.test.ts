import { TestHelper } from "../tests/test-helper.js";
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { TransactionManager } from "./transaction-manager.js";
import { AccountUpdate } from "o1js";

describe('zkUSD Lightnet - Functional Integration Test Suite', async () => {
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
});




