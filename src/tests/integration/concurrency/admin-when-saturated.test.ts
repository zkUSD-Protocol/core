import { TestHelper } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import { KeyPair, WithDefault } from '../../../types/utility.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import assert from 'node:assert';
import { PrivateKey, UInt64 } from 'o1js';
import { TransactionHandle } from '../../../transaction/manager.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';
import {
  TxLifecycleStatus,
  statusIsFinal,
} from '../../../transaction/status.js';

// const DEBUG = !!process.env.DEBUG;
// const printTx = DEBUG && true;

// const debugLog = (msg: string) => {
//   if (DEBUG) {
//     console.debug(msg);
//   }
// };

type User = {
  keys: KeyPair;
  vault: KeyPair;
  createVaultHandle?: TransactionHandle;
  depositCollateralHandle?: TransactionHandle;
  mintZkusdHandle?: TransactionHandle;
  burnZkusdHandle?: TransactionHandle;
  wasLiquidatedHandle?: TransactionHandle;
  didLiquidatedHandles?: TransactionHandle[];
};

const BATCHES = 1;
const TX_IN_BATCH = 50;

describe('zkUSD Integration - Concurrent - Can admin on saturated pool ', () => {
  let th: TestHelper<'local' | 'external'>;

  let users: User[] = [];
  let globalHandles: TransactionHandle[] = [];

  let stop: () => void;

  before(async () => {
    const stopExecutor = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const txExecutorInitializers: WithDefault<
      'local' | 'external',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > = {
      local: async () => new LocalTransactionExecutor(),
      external: ExternalTransactionExecutor.initializer(
        { prover: new HttpServerProver({ jobTimeoutSec: 2 * 60 }) },
        stopExecutor
      ),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });
    th._txMgr.transactionOptions.statusChangeWaitingTimeoutMs = 20 * 60 * 1000; // 20 minutes

    await th.deployTokenContracts();
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
      }
    );
    assert.notStrictEqual(engineTokenAccount, undefined);
  });

  after(async () => {
    stop();
  });

  // first saturate the pool with 50 transactions
  const createUsers = async (count: number) => {
    const users: User[] = [];
    for (let i = 0; i < count; i++) {
      const keys = await th.mina.newAccount();
      const vault = PrivateKey.randomKeypair();
      users.push({ keys, vault });
    }
    return users;
  };

  const createVaults = async (start: number, count: number) => {
    const handles: TransactionHandle[] = [];

    for (let i = 0; i < count; i++) {
      const user = users[i];
      // Determine the number of new accounts needed.
      const zkusdTokenAccount = await th.mina.fetchMinaAccount(
        user.keys.publicKey,
        {
          tokenId: th.engine.contract.deriveTokenId(),
        }
      );

      const handle = await th.engineTx(
        user.keys,
        {
          transactionType: ZkusdEngineTransactionType.CREATE_VAULT,
          args: {
            transactionId: `User ${start + i} creates a vault`,
            newAccounts: zkusdTokenAccount ? 1 : 2,
            vaultAddress: user.vault.publicKey.toBase58(),
          },
        },
        { extraSigners: [user.vault.privateKey] }
      );
      user.createVaultHandle = handle;
      handles.push(handle);
    }
    return handles;
  };

  it('should schedule pool saturation', async () => {
    users = await createUsers(TX_IN_BATCH);
    for (let i = 0; i < BATCHES; i++) {
      const start = i * TX_IN_BATCH;
      const count = TX_IN_BATCH;
      const newHandles = await createVaults(start, count);
      globalHandles.push(...newHandles);
    }
  });

  it('hmm', async () => {
    // until there are at least 20 transaction awaiting inclusion - wait
    let awaitingInclusion = globalHandles.filter(
      (handle) =>
        handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION
    ).length;
    while (awaitingInclusion < 15) {
      console.log(`Awaiting inclusion: ${awaitingInclusion}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      awaitingInclusion = globalHandles.filter(
        (handle) =>
          handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION
      ).length;
    }
    // create an admin transaction stopping the protocol with higher fee
    // we wait 2 slots only

    await th.includeEngineTx(
      th.deployer,
      {
        transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
        args: {
          transactionId: 'Admin stops the protocol',
          shouldStop: true,
        },
      },
      {
        executor: 'local',
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
        startingFee: UInt64.from(0.5e9),
        statusChangeWaitingTimeoutMs: 45 * 1000,
      } // 45 seconds
    );

    // the rest of the transactions should be settled eventually
    await Promise.all(
      globalHandles.map((handle) =>
        handle.awaitStatusChange({ until: (status) => statusIsFinal(status) })
      )
    );
  });
});
