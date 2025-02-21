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
import { statusIsFinal } from '../../../transaction/status.js';

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

const MINA_PRICE_START = TestAmounts.PRICE_1_USD;
const MINA_PRICE_LOW = TestAmounts.PRICE_50_CENT;
const MINA_PRICE_HIGH = TestAmounts.PRICE_2_USD;

const INITIAL_COLLATERAL_DEPOSIT = UInt64.from(500e9); // 500 Mina
const INITIAL_MINTING = UInt64.from(300e9); // 300zkusd
const INITIAL_BURNING = UInt64.from(50e9); // 50zkusd

const BATCHES = 1;
const TX_IN_BATCH = 5;

describe('zkUSD Integration - Concurrent Functional - Happy Path - Contract Admin ', () => {
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
    th._txMgr.transactionOptions.statusChangeWaitingTimeoutMs = 20 * 60 * 1000;

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

  //burn
  const burnZkusd = async (user: User, amount: UInt64) => {
    const handle = await th.engineTx(
      user.keys,
      {
        transactionType: ZkusdEngineTransactionType.BURN_ZKUSD,
        args: {
          transactionId: `User ${user.keys.publicKey.toBase58()} burns zkUSD`,
          vaultAddress: user.vault.publicKey.toBase58(),
          zkusdAmount: amount.toString(),
        },
      },
      {
        waitForIncluded: user.mintZkusdHandle
          ? [user.mintZkusdHandle]
          : undefined,
      }
    );
    user.burnZkusdHandle = handle;
    return handle;
  };

  const allUsersBurnZkusd = async (
    start: number,
    count: number,
    amount: UInt64
  ) => {
    const handles: TransactionHandle[] = [];
    for (let i = 0; i < count; i++) {
      const handle = await burnZkusd(users[start + i], amount);
      handles.push(handle);
    }
    return handles;
  };

  const awaitHandles = async (handles: TransactionHandle[]) => {
    await Promise.allSettled(
      handles.map((h: TransactionHandle) =>
        h.awaitStatusChange({ until: (status) => statusIsFinal(status) })
      )
    );
  };

  for (let i = 0; i < BATCHES; i++) {
    let start = i * TX_IN_BATCH;

    it(`Should schedule vault creation for users ${start}-${
      start + TX_IN_BATCH - 1
    }`, async () => {
      users.push(...(await createUsers(TX_IN_BATCH)));
      globalHandles.push(...(await createVaults(start, TX_IN_BATCH)));
    });

    it(`Should schedule collateral deposition for users ${start}-${
      start + TX_IN_BATCH - 1
    }`, async () => {
      globalHandles.push(
        ...(await allUsersDepositCollateral(start, TX_IN_BATCH))
      );
    });

    it(`Should schedule zkUSD minting for users ${start}-${
      start + TX_IN_BATCH - 1
    }`, async () => {
      globalHandles.push(
        ...(await allUsersMintZkusd(start, TX_IN_BATCH, INITIAL_MINTING))
      );
    });

    it(`Should schedule zkUSD burning for users ${start}-${
      start + TX_IN_BATCH - 1
    }`, async () => {
      globalHandles.push(
        ...(await allUsersBurnZkusd(start, TX_IN_BATCH, INITIAL_BURNING))
      );
    });

    // divide users between liquidators and liquidated.

    // 80% of users mint zkUSD
    const liquidatedUsers = Math.floor(TX_IN_BATCH * 0.8);
    assert.ok(liquidatedUsers > 0, 'must have liquidated users');
    assert.ok(TX_IN_BATCH - liquidatedUsers > 0, 'must have liquidators');

    const liquidated = users.slice(start, start + liquidatedUsers);
    const liquidators = users.slice(
      start + liquidatedUsers,
      start + TX_IN_BATCH
    );

    const liquidated_per_liquidator = Math.floor(
      liquidatedUsers / liquidators.length
    );
    // last liquidator may need to liquidate one more
    const liquidated_last =
      liquidatedUsers - liquidated_per_liquidator * liquidators.length;

    it(`Should schedule liquidation for users ${start}-${
      start + TX_IN_BATCH - 1
    }`, async () => {
      // lets get price proof at which we can liquidate
      const minaPriceProof = (
        await th.priceInputMgr.requestProof(MINA_PRICE_LOW)
      ).proof;
      // each liquidator schedule liquidations for their part of the users:
      for (let i = 0; i < liquidators.length; i++) {
        const liquidator = liquidators[i];
        const liquidated_start = i * liquidated_per_liquidator;
        const liquidated_end =
          i === liquidators.length - 1
            ? liquidated_start + liquidated_per_liquidator + liquidated_last
            : liquidated_start + liquidated_per_liquidator;
        // dependencies are liquidators burn handle and liquidatee burn handle
        const dependencies = liquidated
          .slice(liquidated_start, liquidated_end)
          .map((u) => u.burnZkusdHandle);
        // liquidators burn handle
        dependencies.push(liquidator.burnZkusdHandle);

        for (let j = liquidated_start; j < liquidated_end; j++) {
          const handle = await th.engineTx(
            liquidator.keys,
            {
              transactionType: ZkusdEngineTransactionType.LIQUIDATE,
              args: {
                transactionId: `User ${liquidator.keys.publicKey.toBase58()} liquidates user ${liquidated[
                  j
                ].keys.publicKey.toBase58()}`,
                vaultAddress: liquidated[j].vault.publicKey.toBase58(),
                minaPriceProof,
              },
            },
            {
              waitForIncluded: dependencies.filter(
                Boolean
              ) as TransactionHandle[],
            }
          );
          liquidated[j].wasLiquidatedHandle = handle;
          if (liquidator.didLiquidatedHandles) {
            liquidator.didLiquidatedHandles.push(handle);
          } else {
            liquidator.didLiquidatedHandles = [handle];
          }
          globalHandles.push(handle);
        }
      }
    });
  }

  it(`Should have included all the transactions`, async () => {
    await awaitHandles(globalHandles);
    let transactionIncluded = globalHandles.filter(
      (h) => h.txStatus === 'Included'
    );
    let transactionNotIncluded = globalHandles.filter(
      (h) => h.txStatus !== 'Included'
    );
    console.log(`Transactions included: ${transactionIncluded.length}`);
    console.log(`Transactions not included: ${transactionNotIncluded.length}`);
    assert.ok(transactionIncluded.length === globalHandles.length);
  });
});
