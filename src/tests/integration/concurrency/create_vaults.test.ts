import { TestHelper } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import { KeyPair, WithDefault } from '../../../types/utility.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import assert from 'node:assert';
import { PrivateKey } from 'o1js';
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
};

const BATCHES = 1;
const TX_IN_BATCH = 120;

describe('zkUSD Integration - Concurrent Functional - Happy Path - Contract Admin ', () => {
  let th: TestHelper<'local' | 'external'>;

  let users: User[] = [];
  let handles: TransactionHandle[] = [];

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
        { prover: new HttpServerProver() },
        stopExecutor
      ),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });

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
        {tokenId: th.engine.contract.deriveTokenId(),
      });

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
      handles.push(...(await createVaults(start, TX_IN_BATCH)));
    });
  }

  it(`Should have included all the transactions`, async () => {
    await awaitHandles(handles);
    let transactionIncluded = handles.filter((h) => h.txStatus === 'Included');
    let transactionNotIncluded = handles.filter(
      (h) => h.txStatus !== 'Included'
    );
    console.log(`Transactions included: ${transactionIncluded.length}`);
    console.log(`Transactions not included: ${transactionNotIncluded.length}`);
    assert.ok(transactionIncluded.length === handles.length);
  });
});
