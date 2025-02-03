// TODO - document this file, refactor for better readability
import {
  IncludedTransaction,
  PendingTransaction,
  RejectedTransaction,
  Transaction,
  UInt64,
} from 'o1js';
import { TrackedPromise } from '../utils/tracked-promise.js';
import { TransactionStatus } from './transaction-status.js';
import { Mutex } from '../utils/mutex.js';
import { IMinaNetworkInterface } from './mina-network-interface.js';
import { NonceLock } from './nonce-manager.js';

export {
  TransactionExecutionConfig,
  ITransactionExecutor,
  TransactionLifecycle,
  PreparedTransaction,
};

type TransactionLifecycle = {
  provingPromise: TrackedPromise<Transaction<true, true>>;
  sendingPromise: TrackedPromise<PendingTransaction | RejectedTransaction>;
  waitingPromise: TrackedPromise<
    IncludedTransaction | RejectedTransaction | undefined
  >;
};

interface TransactionExecutionConfig {
  o1jsMutex: Mutex;
  mina: IMinaNetworkInterface;
  startingFee: UInt64;
  printTx?: boolean;
}

interface PreparedTransaction {
  getId: () => string;
  tx: Transaction<false, false>;
  depsAwaitingPromise: TrackedPromise<void>;
  mkSigningPromise: <T extends boolean>(
    fee: UInt64,
    tx: Transaction<T, false>
  ) => TrackedPromise<{ signedTx: Transaction<T, true>; nonceLock: NonceLock }>; // nonceLock is used to unlock the nonce after sending
  setStatus: (status: TransactionStatus) => void;
}

interface ITransactionExecutor {
  executeTransaction(
    preparedTx: PreparedTransaction,
    config: TransactionExecutionConfig,
    options?: unknown
  ): Promise<TransactionLifecycle>;
}
