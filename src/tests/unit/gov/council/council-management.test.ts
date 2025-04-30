import { describe, it, before } from 'node:test';

import { TestHelper } from '../../../test-helper.js';
import { rebuildCouncilMerkleMap } from './common.js';
import assert from 'assert';

describe('CouncilManagement', () => {
  let testHelper: TestHelper<'local'>;

  before(async () => {
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: true });
    await testHelper.deployTokenContracts();
  });

  it('should initialize the council', async () => {
    const events = await testHelper.council.fetchEvents();
    const councilMerkleMap = rebuildCouncilMerkleMap(events);

    const onChainRoot = await testHelper.council.councilMerkleMapRoot.fetch();

    assert.deepStrictEqual(councilMerkleMap.root, onChainRoot);
  });
});
