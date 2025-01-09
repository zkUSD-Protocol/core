import { deploy } from '../../deploy.js';
import { MinaChain } from '../../mina.js';
import { TestHelper } from '../test-helper.js';

import { describe, it, before } from 'node:test';

before(async () => {
  await MinaChain.initLightnet();
  const deployer = await MinaChain.newAccount()
  await deploy(MinaChain, deployer);
});

describe('zkUSD Lightnet Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLightnetChain();
  });
});
