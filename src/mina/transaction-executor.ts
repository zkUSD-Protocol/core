// TODO - document this file, refactor for better readability
import {
  Empty,
  IncludedTransaction,
  PendingTransaction,
  Proof,
  RejectedTransaction,
  Transaction,
  UInt64,
  ZkappPublicInput,
} from 'o1js';
import { TrackedPromise } from '../utils/tracked-promise.js';
import {
  RejectedOnInclusion,
  RejectedOnReceive,
  TransactionStatus,
} from './transaction-status.js';
import { Mutex } from '../utils/mutex.js';
import { IMinaNetworkInterface } from './mina-network-interface.js';
import { NonceLock } from './nonce-manager.js';

export {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
  TransactionState,
};

type ProvenTransaction =
  | { isLocal: true; transaction: Transaction<true, any> }
  | { isLocal: false; proofs: (Proof<ZkappPublicInput, Empty> | undefined)[] }
  | { isLocal: false; errors: string[] };

type SentTransaction =
  | { isLocal: true; transaction: PendingTransaction | RejectedTransaction }
  | { isLocal: false; hash: string }
  | { isLocal: false; errors: string[] };

type AwaitedTransaction =
  | {
      isLocal: true;
      transaction:
        | IncludedTransaction
        | RejectedTransaction
        | PendingTransaction
        | undefined;
    }
  | {
      isLocal: false;
      status: 'Included' | RejectedOnInclusion | RejectedOnReceive;
    };

type TransactionState =
  | Transaction<any, true>
  | ProvenTransaction
  | SentTransaction
  | AwaitedTransaction;

type TransactionLifecycle = {
  provingPromise: TrackedPromise<ProvenTransaction>;
  sendingPromise: TrackedPromise<SentTransaction>;
  waitingPromise: TrackedPromise<AwaitedTransaction>;
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
