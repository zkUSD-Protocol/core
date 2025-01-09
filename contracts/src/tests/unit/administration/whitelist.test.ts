import { Field, Poseidon, PrivateKey, PublicKey } from 'o1js';
import { TestHelper } from '../../test-helper.js';
import { OracleWhitelist } from '../../../types.js';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import { transaction } from '../../../utils/transaction.js';

describe('zkUSD Engine Oracle Whitelist Test Suite', () => {
  const testHelper = new TestHelper();
  let whitelist: OracleWhitelist;
  let previousWhitelistHash: Field;
  let newWhitelistHash: Field;

  before(async () => {
    await testHelper.initLocalChain({proofsEnabled: false});
    await testHelper.deployTokenContracts();
    whitelist = testHelper.whitelist;
  });

  beforeEach(async () => {
    //reset the whitelist
    testHelper.whitelist = {
      ...whitelist,
      addresses: [...whitelist.addresses],
    };
  });

  it('should allow the whitelist to be updated with the admin key', async () => {
    const currentWhitelist = testHelper.whitelistedOracles.size;
    const whitelist = testHelper.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    previousWhitelistHash =
      (await testHelper.engine.contract.oracleWhitelistHash.fetch()) as Field;

    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleWhitelist(whitelist);
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const expectedWhitelistHash = Poseidon.hash(
      OracleWhitelist.toFields(whitelist)
    );

    newWhitelistHash =
      (await testHelper.engine.contract.oracleWhitelistHash.fetch()) as Field;

    assert.deepStrictEqual(newWhitelistHash, expectedWhitelistHash);
  });

  it('should emit the oracle whitelist update event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'OracleWhitelistUpdated');
    // @ts-ignore
    assert.deepStrictEqual(latestEvent.event.data.newHash, newWhitelistHash);

    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.previousHash,
      previousWhitelistHash
    );
  });

  it('should not allow updating the whitelist without the admin key', async () => {
    const whitelist = testHelper.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    await assert.rejects(
      transaction(testHelper.deployer, async () => {
        await testHelper.engine.contract.updateOracleWhitelist(whitelist);
      }),
      /Transaction verification failed/
    );
  });

  it('should not allow updating with a whitelist that has more than 8 addresses', async () => {
    const whitelist = testHelper.whitelist;

    for (let i = 0; i < 10; i++) {
      whitelist.addresses[i] = PrivateKey.random().toPublicKey();
    }

    await assert.rejects(
      transaction(
        testHelper.deployer,
        async () => {
          await testHelper.engine.contract.updateOracleWhitelist(whitelist);
        },
        {
          extraSigners: [testHelper.networkKeys.engine.privateKey],
        }
      ),
      /Expected witnessed values of length 16, got 20./
    );
  });

  it('should not allow updating with an invalid whitelist', async () => {
    testHelper.whitelist.addresses[1] = 'RandomString' as unknown as PublicKey;

    await assert.rejects(
      transaction(
        testHelper.deployer,
        async () => {
          await testHelper.engine.contract.updateOracleWhitelist(
            testHelper.whitelist
          );
        },
        {
          extraSigners: [testHelper.networkKeys.engine.privateKey],
        }
      ),
      /Cannot convert undefined to a BigInt/
    );
  });
});
