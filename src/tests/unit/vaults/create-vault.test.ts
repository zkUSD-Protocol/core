import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { Vault, VaultErrors } from '../../../types/vault.js';
import { AccountUpdate } from 'o1js';

describe('zkUSD Deployment Test Suite', () => {
  let testHelper: TestHelper;

  before(async () => {
    testHelper = await TestHelper.initLocalChain({ proofsEnabled: false });
    await testHelper.deployTokenContracts();
    await testHelper.createAgents('alice', 'bob', 'charlie', 'david', 'eve');
  });

  it('should fail to create a vault from outside of the engine', async () => {
    const keys = testHelper.createVaultKeyPair();

    await assert.rejects(async () => {
      await testHelper.includeTx(
        testHelper.agents.alice.keys,
        async () => {
          //Create the new vault on the token account of the engine
          AccountUpdate.fundNewAccount(
            testHelper.agents.alice.keys.publicKey,
            1
          );
          const newVaultUpdate = AccountUpdate.createSigned(
            keys.publicKey,
            testHelper.engine.contract.deriveTokenId()
          );
          Vault.initialize(newVaultUpdate, keys.publicKey);
        },
        {
          extraSigners: [keys.privateKey],
        }
      );
    }, new RegExp('Token_owner_not_caller'));
  });

  it('should create vaults', async () => {
    await testHelper.createVaults('alice');

    const aliceVault = testHelper.mina.fetchMinaAccount(
      testHelper.agents.alice.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
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
      await testHelper.includeTx(
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
    }, new RegExp(VaultErrors.VAULT_EXISTS));
  });

  it('Deployed vault should have clean state and valid owner', async () => {
    const vault = await testHelper.retrieveVault('alice');

    assert(vault?.state.collateralAmount.equals(TestAmounts.ZERO));
    assert(vault?.state.debtAmount.equals(TestAmounts.ZERO));
    assert(vault?.state.owner.equals(testHelper.agents.alice.keys.publicKey));
  });

  it('should create multiple vaults', async () => {
    await testHelper.createVaults('bob', 'charlie', 'david', 'eve');

    const bobVault = testHelper.mina.fetchMinaAccount(
      testHelper.agents.bob.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
    );
    const charlieVault = testHelper.mina.fetchMinaAccount(
      testHelper.agents.charlie.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
    );
    const davidVault = testHelper.mina.fetchMinaAccount(
      testHelper.agents.david.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
    );
    const eveVault = testHelper.mina.fetchMinaAccount(
      testHelper.agents.eve.vault?.publicKey!,
      { tokenId: testHelper.engine.contract.deriveTokenId() }
    );

    assert.notStrictEqual(bobVault, null);
    assert.notStrictEqual(charlieVault, null);
    assert.notStrictEqual(davidVault, null);
    assert.notStrictEqual(eveVault, null);
  });
});
