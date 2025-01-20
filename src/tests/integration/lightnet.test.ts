import { TestHelper } from '../test-helper.js';

import { describe, before } from 'node:test';


describe('zkUSD Lightnet Test Suite', () => {
  let testHelper: TestHelper;

  before(async () => {
    testHelper = await TestHelper.initLightnetChain();
  });

  it('can deploy contracts', async () => {
    await testHelper.deployTokenContracts();
  });
});
