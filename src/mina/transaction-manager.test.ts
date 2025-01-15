import { TestHelper } from "../tests/test-helper.js";
import { describe, it, before } from 'node:test';
import { TransactionManager } from "./transaction-manager.js";

describe('zkUSD Lightnet - Functional Integration Test Suite', async () => {
  const testHelper = await TestHelper.initLocalChain();
  const txMgr = TransactionManager.new(testHelper.mina);

  before(async () => {
  });

  it('can create a tx and await until it is included', async () => {


  });
});
