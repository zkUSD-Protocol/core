import {
  AccountUpdate,
  fetchEvents,
  Field,
  Mina,
  PublicKey,
  TokenId,
  UInt64,
} from 'o1js';
import { ZkUsdEngineErrors } from '../../../contracts/zkusd-engine.js';
import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Deployment Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initLocalChain({proofsEnabled: false});
    await testHelper.deployTokenContracts();
    await testHelper.createAgents(['alice', 'bob', 'charlie', 'david', 'eve']);
  });

  it('should create vaults', async () => {
    await testHelper.createVaults(['alice']);

    const aliceVault = testHelper.chain.getAccount(
      testHelper.agents.alice.vault?.publicKey!,
      testHelper.engine.contract.deriveTokenId()
    );

    assert.notStrictEqual(aliceVault, null);
  });

  it('should emit the NewVault event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'NewVault');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
  });

  it('should fail to deploy the same vault twice', async () => {
    await assert.rejects(async () => {
      await transaction(
        testHelper.agents.alice.keys,
        async () => {
          await testHelper.engine.contract.createVault(
            testHelper.agents.alice.vault!.publicKey
          );
        },
        {
          extraSigners: [testHelper.agents.alice.vault!.privateKey],
        }
      );
    }, new RegExp(ZkUsdEngineErrors.VAULT_EXISTS));
  });

  it('should create a new vault vault with empty state', async () => {
    const aliceVault = testHelper.agents.alice.vault;

    const collateralAmount =
      await aliceVault?.contract.collateralAmount.fetch();
    const debtAmount = await aliceVault?.contract.debtAmount.fetch();

    assert.deepStrictEqual(collateralAmount, TestAmounts.ZERO);
    assert.deepStrictEqual(debtAmount, TestAmounts.ZERO);
  });

  it('should create a new vault vault with the correct owner', async () => {
    const aliceVault = testHelper.agents.alice.vault;

    const owner = await aliceVault?.contract.owner.fetch();

    assert.strictEqual(
      owner?.toBase58(),
      testHelper.agents.alice.keys.publicKey.toBase58()
    );
  });

  it('should create multiple vaults', async () => {
    await testHelper.createVaults(['bob', 'charlie', 'david', 'eve']);

    const bobVault = testHelper.chain.getAccount(
      testHelper.agents.bob.vault?.publicKey!,
      testHelper.engine.contract.deriveTokenId()
    );
    const charlieVault = testHelper.chain.getAccount(
      testHelper.agents.charlie.vault?.publicKey!,
      testHelper.engine.contract.deriveTokenId()
    );
    const davidVault = testHelper.chain.getAccount(
      testHelper.agents.david.vault?.publicKey!,
      testHelper.engine.contract.deriveTokenId()
    );
    const eveVault = testHelper.chain.getAccount(
      testHelper.agents.eve.vault?.publicKey!,
      testHelper.engine.contract.deriveTokenId()
    );

    assert.notStrictEqual(bobVault, null);
    assert.notStrictEqual(charlieVault, null);
    assert.notStrictEqual(davidVault, null);
    assert.notStrictEqual(eveVault, null);
  });
});
