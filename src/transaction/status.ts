import {
  IncludedTransaction,
  PendingTransaction,
  RejectedTransaction,
} from 'o1js';

/**
 * Type guard: Checks whether a transaction is rejected.
 */
export function statusIsRejectedTransaction(
  tx: PendingTransaction | IncludedTransaction | RejectedTransaction
): tx is RejectedTransaction {
  return tx.status === 'rejected';
}

/**
 * Indicates that a transaction is waiting for other transactions to be included first.
 */
export type AwaitingForOtherTx = {
  kind: 'AwaitingForOtherTx';
  txs: string[];
};

/**
 * Indicates that a transaction is being retried with a higher fee.
 */
export type RetryingWithHigherFee = {
  kind: 'RetryingWithHigherFee';
  failureCount: number;
};

/**
 * Indicates that a transaction is scheduled for cancellation.
 */
export type ScheduledForCancellation = {
  kind: 'ScheduledForCancellation';
  cancellationTx: string;
};

/**
 * Indicates that a transaction failed because a dependency was rejected or dropped.
 */
export type DependencyRejectedFailedOrDropped = {
  kind: 'DependencyRejectedFailedOrDropped';
  depId: string;
  depStatus: TransactionStatus;
};

/**
 * Indicates that a transaction failed because a dependency was rejected or dropped.
 */
export type FailedBeforeSending = {
  kind: 'FailedBeforeSending';
  errors: string[];
};

export type RejectedOnReceive = {
  kind: 'RejectedOnReceive';
  errors: string[];
};

export type RejectedOnInclusion = {
  kind: 'RejectedOnInclusion';
  errors: string[];
};

export const statusIsOfKind = (
  status: TransactionStatus,
  ...kind: string[]
): boolean => {
  if (typeof status === 'object' && status !== null) {
    return kind.includes(status.kind);
  }
  return kind.includes(status);
};

export const statusIsRejected = (
  status: TransactionStatus
): status is RejectedOnReceive | RejectedOnInclusion => {
  return statusIsOfKind(status, 'RejectedOnReceive', 'RejectedOnInclusion');
};

export const statusIsChainResolved = (
  status: TransactionStatus
): status is RejectedOnInclusion | 'Included' => {
  return statusIsOfKind(status, 'RejectedOnInclusion', 'Included');
};

/**
 * Processing states for a transaction that is still in progress.
 */
type ProcessingTxStatus =
  | 'Scheduled'
  | AwaitingForOtherTx
  | 'Pending'
  | ScheduledForCancellation
  | RetryingWithHigherFee;

/**
 * Failure states for a transaction that cannot progress further.
 */
type FailedTxStatus =
  | RejectedOnInclusion
  | RejectedOnReceive
  | FailedBeforeSending
  | 'Cancelled'
  | 'DroppedFromMempool' // still not "implemented"
  | 'StuckInMempool' // Timed out while waiting; treated as failed
  | DependencyRejectedFailedOrDropped;

/**
 * Represents all possible states of a transaction.
 */
export type TransactionStatus =
  | ProcessingTxStatus
  | FailedTxStatus
  | 'Included';

/**
 * Checks whether a transaction status indicates that it should still be awaited (i.e., it's in progress).
 */
export function statusShouldBeWaitedFor(
  status: TransactionStatus
): status is ProcessingTxStatus {
  const inProgressStates = [
    'Scheduled',
    'Pending',
    'AwaitingForOtherTx',
    'ScheduledForCancellation',
    'RetryingWithHigherFee',
  ];
  return statusIsOfKind(status, ...inProgressStates);
}

/**
 * Checks whether a transaction status indicates that it has failed.
 */
export function statusIsFailed(
  status: TransactionStatus
): status is FailedTxStatus {
  const failureStates = [
    'RejectedOnInclusion',
    'RejectedOnReceive',
    'FailedBeforeSending',
    'Cancelled',
    'DroppedFromMempool',
    'DependencyRejectedFailedOrDropped',
  ];
  return statusIsOfKind(status, ...failureStates);
}

/**
 * Checks whether a transaction status is final (either included or failed).
 */
export function statusIsFinal(
  status: TransactionStatus
): status is 'Included' | FailedTxStatus {
  return !statusShouldBeWaitedFor(status);
}

export function mkStatusFailedBeforeSending(
  txId: string,
  phase: string,
  error: unknown
): FailedBeforeSending {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const err = `${txId} - error during ${phase}: ${errorMessage}`;
  return { kind: 'FailedBeforeSending', errors: [err] };
}

/**
 * Represents the user-facing status of a transaction throughout its lifecycle,
 * including preparation, proving, and network stages.
 */
export enum TxLifecycleStatus {
  // Preparation phases
  SIGNING = 'SIGNING', // User is signing the transaction
  PREPARING = 'PREPARING', // Initial transaction preparation
  AWAITING_DEPENDENCIES = 'AWAITING_DEPENDENCIES', // Waiting for dependencies to be included
  COMPILING = 'COMPILING', // Smart contract compilation
  PROVING = 'PROVING', // Zero-knowledge proof generation

  // Network phases
  SCHEDULED = 'SCHEDULED', // Transaction is scheduled to be sent
  PENDING = 'PENDING', // Transaction is in mempool
  AWAITING_INCLUSION = 'AWAITING_INCLUSION', // Waiting for block inclusion

  // Final states
  SUCCESS = 'SUCCESS', // Transaction included in a block
  FAILED = 'FAILED', // Transaction failed (various reasons)
  CANCELLED = 'CANCELLED', // Transaction was cancelled
}
