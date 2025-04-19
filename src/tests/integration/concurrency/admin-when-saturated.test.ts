import { TestAmounts, TestHelper } from '../../test-helper.js';
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
import whyIsNodeRunning from 'why-is-node-running';
import {
  TxLifecycleStatus,
  statusIsChainResolved,
  statusIsFailed,
  statusIsFinal,
  statusIsOfKind,
} from '../../../transaction/status.js';
import { DEBUG, debugLog } from '../../../utils/debug.js';

// --------------------------------------------------------
// This test follows the following scenaro:
// - it creates users and vaults for them
// - users deposit fund, mint zkusd
// - after network achieves saturation
//   (there's 13 tx - more than the network can process within 2 blocks)
//   the engine is stopped.
// - the assertion is made that all the minting operations made after the stop
// - will fail. The rest should succeed.

const printTx = DEBUG && true;

type User = {
  keys: KeyPair;
  vault: KeyPair;
  createVaultHandle?: TransactionHandle;
  depositCollateralHandle?: TransactionHandle;
  mintZkusdHandle?: TransactionHandle;
};

const BATCHES = 1;
const TX_IN_BATCH = 20;
const INITIAL_COLLATERAL_DEPOSIT = UInt64.from(500e9); // 500 Mina
const MINA_PRICE_START = TestAmounts.PRICE_1_USD;
const INITIAL_MINTING = UInt64.from(10e9); // 300zkusd

const MINIMAL_SATURATION = 13;
const MINIMAL_MINTS_IN_MEMPOOL = 7;

// this test is dependent on the set of workers proving transactions in time.
// in practice the more the better.
// if you don't have enough workers to process transactions in time, the test will timeout and fail
// because it will not achieve preliminary conditions.
// In that case you may want to experiment with setting alternative slot time on Lightnet.
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
      external: ExternalTransactionExecutor.initializer({
        prover: new HttpServerProver(),
        stop: stopExecutor,
      }),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });
    th.txMgr.transactionOptions.statusChangeWaitingTimeoutMs = 20 * 60 * 1000; // 20 minutes
    th.txMgr.transactionOptions.dependencyStatusPollTimeoutMs = 20 * 60 * 1000; // 20 minutes

    await th.deployTokenContracts();
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );
    assert.notStrictEqual(engineTokenAccount, undefined);

    // if protocol stopped then resume
    await th.mina.fetchMinaAccount(th.engine.contract.address, { force: true });
    // fetchAccount({publicKey: th.engine.contract.address });
    // this
    const stopped = th.engine.contract.isEmergencyStopped().toBoolean();

    if (stopped) {
      debugLog('Protocol is stopped, resuming first...');
      await th.includeEngineTx(
        th.deployer,
        {
          transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
          args: {
            transactionId: `Pre-test resuming the protocol`,
            shouldStop: false,
          },
        },
        { printTx, extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
      );
      debugLog('Protocol resumed...');
    }
  });

  after(async () => {
    stop();
    await th.txMgr.shutdown();
    setImmediate(() => whyIsNodeRunning());
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
          force: true,
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

  const depositCollateral = async (user: User) => {
    const handle = await th.engineTx(
      user.keys,
      {
        transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
        args: {
          transactionId: `User ${user.keys.publicKey.toBase58()} deposits collateral`,
          vaultAddress: user.vault.publicKey.toBase58(),
          collateralAmount: INITIAL_COLLATERAL_DEPOSIT.toString(),
        },
      },
      {
        extraSigners: [user.vault.privateKey],
        waitForIncluded: user.createVaultHandle
          ? [user.createVaultHandle]
          : undefined,
      }
    );
    user.depositCollateralHandle = handle;
    return handle;
  };

  const allUsersDepositCollateral = async (start: number, count: number) => {
    const handles: TransactionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const handle = await depositCollateral(users[start + i]);
      handles.push(handle);
    }
    return handles;
  };
  const mintZkusd = async (user: User, amount: UInt64) => {
    const minaPriceProof = (
      await th.priceInputMgr.requestProof(MINA_PRICE_START)
    ).proof;
    const handle = await th.engineTx(
      user.keys,
      {
        transactionType: ZkusdEngineTransactionType.MINT_ZKUSD,
        args: {
          transactionId: `User ${user.keys.publicKey.toBase58()} mints zkUSD`,
          vaultAddress: user.vault.publicKey.toBase58(),
          zkusdAmount: amount.toString(),
          minaPriceProof,
        },
      },
      {
        waitForIncluded: user.depositCollateralHandle
          ? [user.depositCollateralHandle]
          : undefined,
      }
    );
    user.mintZkusdHandle = handle;
    return handle;
  };

  const allUsersMintZkusd = async (
    start: number,
    count: number,
    amount: UInt64
  ) => {
    const handles: TransactionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const handle = await mintZkusd(users[start + i], amount);
      handles.push(handle);
    }
    return handles;
  };

  it('should schedule vault creation', async () => {
    users = await createUsers(TX_IN_BATCH);
    for (let i = 0; i < BATCHES; i++) {
      const start = i * TX_IN_BATCH;
      const count = TX_IN_BATCH;
      const newHandles = await createVaults(start, count);
      globalHandles.push(...newHandles);
    }
  });

  it('should schedule collateral deposit', async () => {
    for (let i = 0; i < BATCHES; i++) {
      const start = i * TX_IN_BATCH;
      const count = TX_IN_BATCH;
      const newHandles = await allUsersDepositCollateral(start, count);
      globalHandles.push(...newHandles);
    }
  });

  it('should schedule minting zkusd', async () => {
    for (let i = 0; i < BATCHES; i++) {
      const start = i * TX_IN_BATCH;
      const count = TX_IN_BATCH;
      const newHandles = await allUsersMintZkusd(start, count, INITIAL_MINTING);
      globalHandles.push(...newHandles);
    }
  });

  it('Should be able to stop the protocol on saturated mempool within 2 slots', async () => {
    // until there are at least 20 transaction awaiting inclusion - wait
    let awaitingInclusion = globalHandles.filter(
      (handle) =>
        handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION
    ).length;
    let mintingAwaiting = globalHandles.filter(
      (handle) =>
        handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION &&
        handle.txId.includes('mints')
    ).length;
    while (awaitingInclusion == 0) {
      awaitingInclusion = globalHandles.filter(
        (handle) =>
          handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION
      ).length;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const saturation = () =>
      awaitingInclusion >= MINIMAL_SATURATION &&
      mintingAwaiting >= MINIMAL_MINTS_IN_MEMPOOL;
    const oneMintSuccesful = () => {
      const minting = globalHandles.filter(
        (handle) =>
          handle.txStatus === 'Included' && handle.txId.includes('mints')
      ).length;
      return minting >= 0;
    };

    const saturationTimeout = Date.now() + 5 * 60 * 1000; // 5 minutes
    while (!saturation() || !oneMintSuccesful()) {
      debugLog(
        `Awaiting inclusion: ${awaitingInclusion}/${MINIMAL_SATURATION}`
      );
      debugLog(
        `Minting transactions awaiting inclusion: ${mintingAwaiting}/${MINIMAL_MINTS_IN_MEMPOOL}`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      awaitingInclusion = globalHandles.filter(
        (handle) =>
          handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION
      ).length;
      mintingAwaiting = globalHandles.filter(
        (handle) =>
          handle.lifecycleStatus === TxLifecycleStatus.AWAITING_INCLUSION &&
          handle.txId.includes('mints')
      ).length;
      if (Date.now() > saturationTimeout) {
        throw new Error(
          'Unable to achive preliminary test conditions within 5 minutes.'
        );
      }
    }
    debugLog(`Awaiting inclusion: ${awaitingInclusion}`);
    debugLog(
      `Minting transactions awaiting inclusion: ${mintingAwaiting}/${MINIMAL_MINTS_IN_MEMPOOL}`
    );
    debugLog(
      'Mempool assumed saturated - lightnet processes 5-6 zkapp txes per block.'
    );

    debugLog('------------------------');
    const stopProtocolHandle = await th.includeEngineTx(
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

    // set a time out of 8 minutes starting now
    const timeout = Date.now() + 8 * 60 * 1000;
    let done = 0;

    while (Date.now() < timeout) {
      try {
        await Promise.all(
          globalHandles.map((handle) =>
            handle.awaitStatusChange({
              until: (status) => statusIsFinal(status),
              timeout: 4000,
            })
          )
        );
        done = 1;
        break;
      } catch (e) {
        // Transactions not yet final
        const notFinal = globalHandles.filter(
          (handle) => !statusIsFinal(handle.txStatus)
        );

        // A single line for the summary
        debugLog(`Not yet final: ${notFinal.length}`);

        // Print the first 5 in detail
        notFinal.slice(0, 5).forEach((handle, i) => {
          const jsonStatus = JSON.stringify(handle.txStatus, null, 2);
          debugLog(`${i}. - ${jsonStatus} - ${handle.txId}`);
        });
      }
    }

    if (!done) {
      throw new Error(
        'Timeout - not all transactions were settled within 5 minutes'
      );
    }

    await Promise.all(
      globalHandles.map((handle) =>
        handle.awaitStatusChange({ until: (status) => statusIsFinal(status) })
      )
    );

    debugLog('-------------------');
    assert.ok(stopProtocolHandle.resolutionBlockHeight);
    const stoppedAtBlock = stopProtocolHandle.resolutionBlockHeight;

    debugLog(`Stopped at block: ${stoppedAtBlock}`);

    debugLog(`Current status of all transactions:`);

    //sort by resolution block
    globalHandles
      .sort((a, b) => {
        if (!a.resolutionBlockHeight) return 1; // Move `undefined` or `null` values to the end
        if (!b.resolutionBlockHeight) return -1; // Move `undefined` or `null` values to the end
        return Number(a.resolutionBlockHeight - b.resolutionBlockHeight);
      })
      .forEach((handle) => {
        debugLog(
          handle.resolutionBlockHeight,
          handle.txId,
          handle.lifecycleStatus,
          handle.txStatus
        );
        if (typeof handle.txStatus == 'object' && 'txs' in handle.txStatus) {
          debugLog(handle.txStatus.txs);
        }
      });

    // check if status are as expected
    globalHandles.forEach((handle) => {
      // if not resolved print the stringifie status and tx id
      if (!statusIsChainResolved(handle.txStatus)) {
        debugLog(handle.txId, JSON.stringify(handle.txStatus, null, 2));
      }

      if (handle.txId.includes('mints')) {
        // minting is affected by the protocol stop
        if (!handle.resolutionBlockHeight) {
          assert.ok(!statusIsOfKind(handle.txStatus, 'RejectedOnInclusion'));
          assert.ok(statusIsFailed(handle.txStatus));
        } else if (handle.resolutionBlockHeight >= stoppedAtBlock) {
          assert.ok(statusIsFailed(handle.txStatus));
        } else {
          assert.ok(statusIsOfKind(handle.txStatus, 'Included'));
        }
      } else {
        // other txes should be included
        assert.ok(statusIsOfKind(handle.txStatus, 'Included'));
      }
    });
    debugLog('All tx before stopped were included, all after were rejected.');
  });
});
