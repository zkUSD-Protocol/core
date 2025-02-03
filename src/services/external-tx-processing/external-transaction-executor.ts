import { Empty, Proof, Transaction, ZkappPublicInput } from 'o1js';
import {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from '../../mina/transaction-executor.js';
import {
  FailedBeforeSending,
  RejectedOnInclusion,
  RejectedOnReceive,
} from '../../mina/transaction-status.js';
import { TrackedPromise } from '../../utils/tracked-promise.js';

export { ExternalTransactionExecutor };

type TxLifecycleTracker = {
  proving: {
    resolvers: ((
      proofs: (Proof<ZkappPublicInput, Empty> | undefined)[]
    ) => void)[];
    rejectors: ((st: { status: FailedBeforeSending }) => void)[];
  };
  sending: {
    resolvers: (({
      hash,
      status,
    }: {
      hash: string;
      status: 'Pending';
    }) => void)[];
    rejectors: ((st: {
      status: RejectedOnReceive | FailedBeforeSending;
    }) => void)[];
  };
};

const mkEmptyTxLifecycleTracker: () => TxLifecycleTracker = () => {
  return {
    proving: {
      resolvers: [],
      rejectors: [],
    },
    sending: {
      resolvers: [],
      rejectors: [],
    },
  };
};

interface WorkerManager {
  scheduleTxExecution(args:{signedTx: Transaction<any,true>, lifecycleTracker: TxLifecycleTracker}): Promise<void>
}

// TODO add retry logic
class ExternalTransactionExecutor implements ITransactionExecutor {
  workerManager: WorkerManager;

  async executeTransaction(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig,
    _options?: unknown
  ): Promise<TransactionLifecycle> {

    // sign locally and await deps at the same time.
    const [{ signedTx, nonceLock }] = await Promise.all([
      tx.mkSigningPromise(config.startingFee, tx.tx),
      tx.depsAwaitingPromise.catch()
    ]);

    const lifecycleTracker = mkEmptyTxLifecycleTracker();

    const mkRet = <T>(st: T) => {
      return { isLocal: false as false, ...st };
    };
    const mkErr = (err: {
      status:
        | RejectedOnReceive
        | RejectedOnInclusion
        | FailedBeforeSending
    }) => {
      return { isLocal: false as false, errors: err.status.errors };
    };

    // execution will  happen externally in one go
    // phases will be updated by status callback

    // build proving tracking promise
    const provingPromise = new TrackedPromise<ProvenTransaction>(() => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Proving ...`);
      }

      return new Promise<(Proof<ZkappPublicInput, Empty> | undefined)[]>(
        (resolve, reject) => {
          lifecycleTracker.proving.resolvers.push(resolve);
          lifecycleTracker.proving.rejectors.push(reject);
        }
      )
        .then((proofs) => {
          return mkRet({proofs});
        })
        .catch(({ status }) => {
          tx.setStatus(status);
          return mkErr(status);
        });
    }, `Proving tx: ${tx.getId()} promise.`);

    // build sending tracking promise
    const sendingPromise = new TrackedPromise<SentTransaction>(() => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Sending ...`);
      }

      return new Promise<{hash:string, status: 'Pending'}>((resolve, reject) => {
        lifecycleTracker.sending.resolvers.push(resolve);
        lifecycleTracker.sending.rejectors.push(reject);
      })
        .then(async ({hash, status}) => {
          await nonceLock.unlock();
          tx.setStatus(status)
          return mkRet({ hash });
        })
        .catch(async ({status}) => {
          await nonceLock.unlock();
          tx.setStatus(status);
          return mkErr(status);
        });
    }, `Sending tx: ${tx.getId()} promise.`);

    // build waiting tracking promise
    const waitingPromise = new TrackedPromise<AwaitedTransaction>(async () => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Awaiting inclusion ...`);
      }
      // TODO
      return mkRet({ status: 'Included' as 'Included' });
    }, `Waiting tx: ${tx.getId()} promise.`);

    this.workerManager.scheduleTxExecution({
      signedTx,
      lifecycleTracker,
    });

    return Promise.resolve({
      provingPromise,
      sendingPromise,
      waitingPromise,
    });
  }
}
