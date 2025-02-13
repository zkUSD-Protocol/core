import { AccountUpdate, Bool, PrivateKey } from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { ProtocolData } from '../../../system/engine.js';

describe('zkUSD Protocol Administration Test Suite', async () => {
  let th: TestHelper<'local'>;

  const newAdmin = PrivateKey.randomKeypair();

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();
    await th.createLocalAgents('alice');
    await th.createVaults('alice');

    //Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      {
        name: 'Protocol Admin Test Suite: Alice deposits 100 Mina',
      }
    );

    //Fund the creation of the new admin keys
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(th.agents.alice.keys.publicKey, 1);
        AccountUpdate.create(newAdmin.publicKey);
      },
      {
        name: 'Protocol Admin Test Suite: Alice creates new admin key',
      }
    );
  });

  it('should allow the admin key to be changed with the current admin key', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.updateAdmin(newAdmin.publicKey);
      },
      {
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
        name: 'Protocol Admin Test Suite: Alice updates admin key',
      }
    );

    //Verify the admin key is updated
    const packedData = await th.engine.contract.protocolDataPacked.fetch();
    const protocolData = ProtocolData.unpack(packedData!);

    assert.deepStrictEqual(protocolData.admin, newAdmin.publicKey);
  });

  it('should emit the admin update event', async () => {
    const contractEvents = await th.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'AdminUpdated');
    // @ts-ignore
    assert.deepStrictEqual(latestEvent.event.data.newAdmin, newAdmin.publicKey);
    assert.deepStrictEqual(
      // @ts-ignore

      latestEvent.event.data.previousAdmin,
      th.networkKeys.protocolAdmin.publicKey
    );
  });

  it('should allow the new admin key to make updates to the protocol vault', async () => {
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.toggleEmergencyStop(Bool(true));
      },
      {
        extraSigners: [newAdmin.privateKey],
        name: 'Protocol Admin Test Suite: Alice stops the protocol',
      }
    );

    let packedData = await th.engine.contract.protocolDataPacked.fetch();
    let protocolData = ProtocolData.unpack(packedData!);

    assert.deepStrictEqual(protocolData.emergencyStop, Bool(true));

    //Resume the protocol
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.toggleEmergencyStop(Bool(false));
      },
      {
        extraSigners: [newAdmin.privateKey],
        name: 'Protocol Admin Test Suite: Alice resumes the protocol',
      }
    );

    packedData = await th.engine.contract.protocolDataPacked.fetch();
    protocolData = ProtocolData.unpack(packedData!);

    assert.deepStrictEqual(protocolData.emergencyStop, Bool(false));
  });

  it('should not allow the admin key to be updated without the current admin key', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.updateAdmin(newAdmin.publicKey);
        },
        {
          name: 'Protocol Admin Test Suite: Alice attempts to update admin key without current admin key',
        }
      );
    }, /Transaction verification failed/i);
  });
});
