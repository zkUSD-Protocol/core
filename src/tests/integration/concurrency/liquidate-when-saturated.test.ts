import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { TestAmounts, TestHelper } from '../../test-helper.js';
import { KeyPair, WithDefault } from '../../../types/utility.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import {
  ExternalTransactionExecutor,
  sentTxs,
} from '../../../transaction/external-executor.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import { PrivateKey, UInt64 } from 'o1js';
import { TransactionHandle } from '../../../transaction/manager.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';

// ----------------------------------------------------------
// This test suite is designed to test the following scenario:
// 1. Create 2 users, create vaults, deposit collateral, and mint zkUSD.
// 2. Send multiple payments to saturate the network.
// 3. Liquidate one of the users.
// 4. Ensure liquidation is successful and completes within 2 blocks.
// ----------------------------------------------------------


//
// ------------------- Constants & Config -------------------
//
const DEBUG = !!process.env.DEBUG; // Toggle with "DEBUG=1 node test.js"
function debugLog(message?: any, ...args: any[]) {
  if (DEBUG) console.debug(message, ...args);
}

// Transaction fees
const LARGE_FEE = 3e8; // 0.2 MINA

// Test config
const TX_IN_BATCH = 50;
const MINIMAL_SATURATION = 20;
const INITIAL_COLLATERAL_DEPOSIT = UInt64.from(500e9); // 500 MINA
const MINA_PRICE_START = TestAmounts.PRICE_1_USD;
const INITIAL_MINTING = UInt64.from(250e9); // 300 zkUSD

// Timeout: 10 minutes to meet test conditions
const TEST_TIMEOUT_MS = 10 * 60 * 1000;

//
type User = {
  keys: KeyPair;
  vault: KeyPair;
  createVaultHandle?: TransactionHandle;
  depositCollateralHandle?: TransactionHandle;
  mintZkusdHandle?: TransactionHandle;
};

//
// ------------------- Test Suite -------------------
//
describe('zkUSD Integration - Concurrent - Can admin and liquidate on saturated pool', () => {
  let th: TestHelper<'local' | 'external'>;
  let stop: () => void;
  let paymentHandles: TransactionHandle[] = [];

  // We store references so we can poll them in the saturation check
  let users: User[] = [];
  let globalHandles: TransactionHandle[] = [];

  // We'll specifically track the two "liquidation" users
  let user0MintedHandle: TransactionHandle;
  let user1MintedHandle: TransactionHandle;

  //
  // ------------------- Before/After Suite -------------------
  //
  before(async () => {
    // Prepare a "stopExecutor" promise so we can signal external workers to stop.
    const stopExecutor = new Promise<void>((resolve) => {
      stop = resolve;
    });

    // Determine which transaction executor to use
    const txExecutorInitializers: WithDefault<
      'local' | 'external',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > = {
      local: async () => new LocalTransactionExecutor(),
      external: ExternalTransactionExecutor.initializer({
        prover: new HttpServerProver(),
        stop: stopExecutor,
      }),
      default: 'external', // use external workers by default
    };

    // Init test helper with your chain setup
    th = await TestHelper.initLightnetChain({ txExecutorInitializers });

    // Extend default timeouts for heavy concurrency
    th._txMgr.transactionOptions.statusChangeWaitingTimeoutMs = 20 * 60 * 1000; // 20 min
    th._txMgr.transactionOptions.dependencyStatusPollTimeoutMs = 20 * 60 * 1000; // 20 min

    // Deploy the zkUSD token contracts
    await th.deployTokenContracts();

    // Verify engine's token account
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );
    assert.ok(engineTokenAccount, 'Engine token account should exist.');

    // Resume protocol if it's emergency stopped
    await th.mina.fetchMinaAccount(th.engine.contract.address, { force: true });
    const stopped = th.engine.contract.isEmergencyStopped().toBoolean();
    if (stopped) {
      debugLog('Protocol is stopped, resuming...');
      await th.includeEngineTx(
        th.deployer,
        {
          transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
          args: {
            transactionId: 'Pre-test resuming the protocol',
            shouldStop: false,
          },
        },
        { extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
      );
      debugLog('Protocol resumed successfully.');
    }
  });

  after(async () => {
    // Signal the external worker to stop, if any
    if (stop) stop();
    await th.txMgr.shutdown();
  });

  //
  // ------------------- Helper Functions -------------------
  //
  async function createUsers(count: number): Promise<User[]> {
    debugLog(`Creating ${count} users...`);
    const created: User[] = [];
    for (let i = 0; i < count; i++) {
      let keys = await th.mina.newAccount();
      let vault = PrivateKey.randomKeypair();
      // while (await th.hasVault(vault.publicKey)) {
      //   vault = await th.mina.newAccount();
      // }
      created.push({ keys, vault });
    }
    return created;
  }

  async function createVaults(start: number, count: number, fee: number) {
    debugLog(`Creating vaults for users [${start}..${start + count - 1}]...`);
    const handles: TransactionHandle[] = [];

    for (let i = 0; i < count; i++) {
      const user = users[start + i];
      const transactionId = `User ${start + i} creates a vault`;
      try {
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
              transactionId,
              // If token account already exists, only 1 new account needed
              newAccounts: zkusdTokenAccount ? 1 : 2,
              vaultAddress: user.vault.publicKey.toBase58(),
            },
          },
          {
            extraSigners: [user.vault.privateKey],
            startingFee: UInt64.from(fee),
          }
        );
        user.createVaultHandle = handle;

        handles.push(handle);
      } catch (err) {
        console.error(`Error creating vault for user index ${start + i}`, err);
        throw err;
      }
    }
    return handles;
  }

  async function depositCollateral(user: User, fee: UInt64) {
    debugLog(`User ${user.keys.publicKey.toBase58()} depositing collateral...`);
    try {
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
          startingFee: fee,
          extraSigners: [user.vault.privateKey],
          waitForIncluded: user.createVaultHandle
            ? [user.createVaultHandle]
            : undefined,
        }
      );
      user.depositCollateralHandle = handle;
      return handle;
    } catch (err) {
      console.error(
        `Error depositing collateral for user ${user.keys.publicKey.toBase58()}`,
        err
      );
      throw err;
    }
  }

  async function allUsersDepositCollateral(
    start: number,
    count: number,
    fee: number
  ) {
    debugLog(
      `Depositing collateral for users [${start}..${start + count - 1}]...`
    );
    const handles: TransactionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const userIndex = start + i;
      const handle = await depositCollateral(
        users[userIndex],
        UInt64.from(fee)
      );
      handles.push(handle);
    }
    return handles;
  }

  async function mintZkusd(user: User, amount: UInt64, fee: UInt64) {
    debugLog(`User ${user.keys.publicKey.toBase58()} minting zkUSD...`);
    const minaPriceProof = (
      await th.priceInputMgr.requestProof(MINA_PRICE_START)
    ).proof;
    try {
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
          startingFee: fee,
          waitForIncluded: user.depositCollateralHandle
            ? [user.depositCollateralHandle]
            : undefined,
        }
      );
      user.mintZkusdHandle = handle;
      return handle;
    } catch (err) {
      console.error(
        `Error minting zkUSD for user ${user.keys.publicKey.toBase58()}`,
        err
      );
      throw err;
    }
  }

  async function allUsersMintZkusd(
    start: number,
    count: number,
    amount: UInt64,
    fee: number
  ) {
    debugLog(`Minting zkUSD for users [${start}..${start + count - 1}]...`);
    const handles: TransactionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const userIndex = start + i;
      const handle = await mintZkusd(
        users[userIndex],
        amount,
        UInt64.from(fee)
      );
      handles.push(handle);
    }
    return handles;
  }

  async function createPayments(start: number, count: number) {
    debugLog(
      `Scheduling payments from users [${start}..${start + count - 1}]...`
    );
    const handles: TransactionHandle[] = [];
    const batch0Handles: TransactionHandle[] = [];
    const waitForIncluded = [];
    while (!users[0].mintZkusdHandle || !users[1].mintZkusdHandle) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    waitForIncluded.push(users[0].mintZkusdHandle);
    waitForIncluded.push(users[1].mintZkusdHandle);
    for (let i = start; i < start + count; i++) {
      const fromUser = users[i];
      const toUser = users[i - 1] ?? users[start + count - 1]; // just to avoid i-1 < 2 scenario
      try {
        const paymentHandle = await th.engineTx(
          fromUser.keys,
          {
            transactionType: ZkusdEngineTransactionType.TRANSFER,
            args: {
              transactionId: `User ${i} sends a tiny payment to user ${i - 1}`,
              from: fromUser.keys.publicKey.toBase58(),
              to: toUser.keys.publicKey.toBase58(),
              amount: '1000000000',
            },
          },
          {
            printTx: true,
            startingFee: UInt64.from(5e7), // 0.05 MINA
            waitForIncluded,
          }
        );
        batch0Handles[i] = paymentHandle;
        handles.push(paymentHandle);
      } catch (err) {
        console.error(`Error creating payment from user index ${i}`, err);
        throw err;
      }
    }
    return handles;
  }

  //
  // ------------------- TEST STEPS -------------------
  //

  it('Should create 2 users, create vaults, deposit collateral, and mint', async () => {
    try {
      // 1. Create 25 total users for concurrency; 2 of them are the main “liquidation" scenario
      users = await createUsers(TX_IN_BATCH);
      assert.equal(
        users.length,
        TX_IN_BATCH,
        'Users array must have TX_IN_BATCH length'
      );

      // 2. Create vaults for first 2 users
      let handles = await createVaults(0, 2, LARGE_FEE);
      globalHandles.push(...handles);

      // 3. Deposit collateral
      handles = await allUsersDepositCollateral(0, 2, LARGE_FEE);
      globalHandles.push(...handles);

      // 4. Mint ZKUSD
      await Promise.all(handles.map(async (h) => await h.awaitIncluded()));
      handles = await allUsersMintZkusd(0, 2, INITIAL_MINTING, LARGE_FEE);
      globalHandles.push(...handles);

      // Keep references to the “liquidation” user’s final TX handles
      user0MintedHandle = handles[0];
      user1MintedHandle = handles[1];

      debugLog(
        'Users[0..1] vault creation, collateral deposit, and minting completed.'
      );
    } catch (err: unknown) {
      assert.fail(`Setup for liquidation users failed: ${JSON.stringify(err)}`);
    }
  });

  it('Should schedule payments to saturate the network', async () => {
    let k = false;
    try {
      // 1. We only want to schedule concurrency among the remaining users
      //    so from index 2 to TX_IN_BATCH.

      const startIndex = 2;
      const count = TX_IN_BATCH; // i.e., up to user[24] if TX_IN_BATCH=25

      const handles = await createPayments(startIndex, count - 2);
      paymentHandles = handles;
      assert.ok(handles.length > 0, 'No payment handles created.');
      globalHandles.push(...handles);

      debugLog(
        `Scheduled ${handles.length} payment transactions for saturation.`
      );
      k = true;
    } catch (err) {
      if (!k) assert.fail(`Scheduling payments failed: ${JSON.stringify(err)}`);
    }
  });

  it('Should await final conditions (saturation + minted) and then liquidate', async () => {
    // We want at least MINIMAL_SATURATION globalHandles at 'Included' status,
    // plus user0 & user1 minted TX included.
    while (!user0MintedHandle || !user1MintedHandle) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const saturation = () =>
      globalHandles.filter((handle) => handle.txStatus === 'Included').length >=
      MINIMAL_SATURATION;

    const liquidationActorsMinted = () => {
      return (
        user0MintedHandle.txStatus === 'Included' &&
        user1MintedHandle.txStatus === 'Included'
      );
    };

    const startTime = Date.now();

    // Poll loop (every 2s) until conditions met or timeout
    while (!(saturation() && liquidationActorsMinted())) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (Date.now() - startTime > TEST_TIMEOUT_MS) {
        assert.fail(
          'Unable to achieve preliminary test conditions within 5 minutes.'
        );
      }

      debugLog(
        'mint txs:',
        user0MintedHandle?.txStatus,
        user1MintedHandle?.txStatus
      );

      debugLog(
        `Still waiting... included count = ${
          globalHandles.filter((h) => h.txStatus === 'Included').length
        }, mintIncluded = ${liquidationActorsMinted()}`
      );
      paymentHandles.forEach((handle) => {
        debugLog(
          `Payment ${handle.txId} status: ${JSON.stringify(handle.txStatus)}`
        );
      });
    }

    // At this point, we know the network is "saturated" and both relevant mints are included.
    debugLog(
      'Network saturated and user0/user1 minted. Proceeding to liquidation...'
    );

    // Prepare a low price to ensure user1 can be liquidated
    const lowPriceProof = (
      await th.priceInputMgr.requestProof(TestAmounts.PRICE_25_CENT)
    ).proof;

    const liquidationBlock = th.mina.getNetworkState().blockchainLength;

    let liquidationHandle: TransactionHandle;
    try {
      liquidationHandle = await th.engineTx(
        users[0].keys,
        {
          transactionType: ZkusdEngineTransactionType.LIQUIDATE,
          args: {
            transactionId: 'User 0 liquidates user 1',
            vaultAddress: users[1].vault.publicKey.toBase58(),
            minaPriceProof: lowPriceProof,
          },
        },
        {
          waitForIncluded: [user0MintedHandle, user1MintedHandle],
          startingFee: UInt64.from(0.5e9), // 0.5 MINA
          statusChangeWaitingTimeoutMs: 45_000,
        }
      );
      await liquidationHandle.awaitIncluded();
    } catch (err) {
      assert.fail(`Error liquidating user1 vault: ${JSON.stringify(err)}`);
    }

    // Check how many blocks advanced
    const postLiquidationBlock = th.mina.getNetworkState().blockchainLength;
    const blockDiff = Number(postLiquidationBlock) - Number(liquidationBlock);
    debugLog(`Liquidation block difference: ${blockDiff}`);
    assert.ok(
      liquidationHandle.resolutionBlockHeight,
      'Liquidation handle missing resolutionBlockHeight'
    );
    assert.ok(
      blockDiff <= 2,
      `Liquidation took more than 2 blocks to finalize (diff = ${blockDiff})`
    );

    debugLog(
      'Liquidation completed successfully within 2 blocks after minting.'
    );
  });
});
