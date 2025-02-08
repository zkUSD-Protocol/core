import { Field, Poseidon, PrivateKey, PublicKey } from 'o1js';
import { TestHelper } from '../../test-helper.js';
import { OracleWhitelist } from '../../../types/oracle.js';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Engine Oracle Whitelist Test Suite', () => {
  let th: TestHelper<'local'>;
  let whitelist: OracleWhitelist;
  let previousWhitelistHash: Field;
  let newWhitelistHash: Field;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    whitelist = th.whitelist;
  });

  beforeEach(async () => {
    //reset the whitelist
    th.whitelist = {
      ...whitelist,
      addresses: [...whitelist.addresses],
    };
  });

  it('should allow the whitelist to be updated with the admin key', async () => {
    const currentWhitelist = th.whitelistedOracles.size;
    const whitelist = th.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    previousWhitelistHash =
      (await th.engine.contract.oracleWhitelistHash.fetch()) as Field;

    await th.includeTx(
      th.deployer,
      async () => {
        await th.engine.contract.updateOracleWhitelist(whitelist);
      },
      {
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
      }
    );

    const expectedWhitelistHash = Poseidon.hash(
      OracleWhitelist.toFields(whitelist)
    );

    newWhitelistHash =
      (await th.engine.contract.oracleWhitelistHash.fetch()) as Field;

    assert.deepStrictEqual(newWhitelistHash, expectedWhitelistHash);
  });

  it('should emit the oracle whitelist update event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
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
    const whitelist = th.whitelist;

    const newOracle = PrivateKey.random().toPublicKey();
    whitelist.addresses[0] = newOracle;

    await assert.rejects(
      th.includeTx(th.deployer, async () => {
        await th.engine.contract.updateOracleWhitelist(whitelist);
      }),
      /Transaction verification failed/
    );
  });

  it('should not allow updating with a whitelist that has more than 8 addresses', async () => {
    const whitelist = th.whitelist;

    for (let i = 0; i < 10; i++) {
      whitelist.addresses[i] = PrivateKey.random().toPublicKey();
    }

    await assert.rejects(
      th.includeTx(
        th.deployer,
        async () => {
          await th.engine.contract.updateOracleWhitelist(whitelist);
        },
        {
          extraSigners: [th.networkKeys.engine.privateKey],
        }
      ),
      /Expected witnessed values of length 16, got 20./
    );
  });

  it('should not allow updating with an invalid whitelist', async () => {
    th.whitelist.addresses[1] = 'RandomString' as unknown as PublicKey;

    await assert.rejects(
      th.includeTx(
        th.deployer,
        async () => {
          await th.engine.contract.updateOracleWhitelist(th.whitelist);
        },
        {
          extraSigners: [th.networkKeys.engine.privateKey],
        }
      ),
      /Cannot convert undefined to a BigInt/
    );
  });
});
