import { deploy } from '../../deploy.js';
import { initBlockchain } from '../../mina.js';
import { TestHelper } from '../unit/unit-test-helper.js';

import { describe, it, before } from 'node:test';

before(async () => {
  const chain = await initBlockchain('lightnet');
  const deployedContracts = await deploy(chain, chain.keys[0]);
});

describe('zkUSD Lightnet Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain({ useLightnet: true });
  });
});
