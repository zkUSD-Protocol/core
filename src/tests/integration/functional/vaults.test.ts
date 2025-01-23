import { TestHelper } from '../../test-helper.js';

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { UInt64 } from 'o1js';

describe('zkUSD Lightnet - Functional Integration Test Suite', () => {
  let testHelper: TestHelper

  before(async () => {
    testHelper = await TestHelper.initLightnetChain();
  });

  it('should be able to deploy contracts on Lightnet', async () => {
    await assert.doesNotReject(
      async () => {
        await testHelper.deployTokenContracts();
      },
      'Expected deployTokenContracts not to throw an exception'
    );
  });


  it('user should be able create a vault', async () => {

    const [alice] = await testHelper.createAgents(['alice']);
    await testHelper.createVaults(['alice']);

    const aliceVault = testHelper.mina.fetchMinaAccount(
      alice.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
    );

    assert.notStrictEqual(aliceVault, null);
  }); 

  it('user should be able to deposit some', async () => {

    const [alice] = await testHelper.createAgents(['alice', 'bob', 'charlie', 'david', 'eve']);


    const tx = await testHelper.tx(alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        alice.vault!.publicKey,
        UInt64.from(1e9)
      );
    });

    await tx.awaitIncluded();

  });
});
