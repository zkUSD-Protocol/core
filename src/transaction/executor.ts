import {
  Field,
  IncludedTransaction,
  PendingTransaction,
  PrivateKey,
  PublicKey,
  RejectedTransaction,
  Transaction,
  UInt64,
} from 'o1js';

import { TrackedPromise } from '../utils/tracked-promise.js';
import { Mutex } from '../utils/mutex.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import { NonceLock } from '../mina/nonce-manager.js';
import { KeyPair } from '../types/utility.js';
import {
  TransactionStatus,
  RejectedOnInclusion,
  RejectedOnReceive,
  TxLifecycleStatus,
} from './status.js';
import { TransactionArgs } from '../system/transaction.js';

export type {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
  TransactionState,
  TransactionArgs,
};

/** Represents a proven transaction before sending. */
type ProvenTransaction =
  | { isLocal: true; transaction: Transaction<true, any> }
  | { isLocal: false; serializedProvenTransaction: string }
  | { isLocal: false; errors: string[] };

/** Represents a transaction that has been sent but not yet confirmed. */
type SentTransaction =
  | { isLocal: true; transaction: PendingTransaction | RejectedTransaction }
  | { isLocal: false; hash: string }
  | { isLocal: false; errors: string[] };

/** Represents a transaction that is awaiting inclusion or rejection. */
type AwaitedTransaction =
  | {
    isLocal: true;
    transaction:
    | IncludedTransaction
    | RejectedTransaction
    | PendingTransaction
    | undefined;
    resolutionBlockHeight?: bigint;
  }
  | {
    isLocal: false;
    status:
    | 'Included'
    | RejectedOnInclusion
    resolutionBlockHeight: bigint;

  } |
  {
    isLocal: false;
    status:
    | RejectedOnReceive
    | 'StuckInMempool';
  };

/** Represents the full transaction state lifecycle. */
type TransactionState =
  | Transaction<any, true>
  | ProvenTransaction
  | SentTransaction
  | AwaitedTransaction;

/** Represents the lifecycle of a transaction with promises. */
type TransactionLifecycle = {
  provingPromise: TrackedPromise<ProvenTransaction>;
  sendingPromise: TrackedPromise<SentTransaction>;
  waitingPromise: TrackedPromise<AwaitedTransaction>;
};

/** Configuration options for executing a transaction. */
interface TransactionExecutionConfig {
  o1jsMutex: Mutex;
  mina: IMinaNetworkInterface;
  startingFee: UInt64;
  inclusionAwaitingTimeoutMs: number;
  printTx?: boolean;
}

/** Represents a transaction that has been prepared for execution. */
interface PreparedTransaction {
  getId: () => string;
  buildTx: Promise<Transaction<false, false>>;
  args?: TransactionArgs;
  keys: {
    sender: KeyPair | PublicKey;
    extraSigners: PrivateKey[];
  };
  nonceLock: (
    publicKey: string | PublicKey,
    tokenId?: Field
  ) => Promise<NonceLock>;
  setStatuses: (
    status: TransactionStatus | 'unchanged',
    lifecycleStatus: TxLifecycleStatus | 'unchanged'
  ) => void;
}

/** Defines the structure of a transaction executor. */
interface ITransactionExecutor {
  executeTransaction(
    preparedTx: PreparedTransaction,
    config: TransactionExecutionConfig,
    options?: unknown
  ): Promise<TransactionLifecycle>;
}
