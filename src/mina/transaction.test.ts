import { TestHelper } from "../tests/test-helper.js";
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Lightnet - Functional Integration Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLightnetChain();
  });

  it('it should show pooled transactions', async () => {

  });
});
