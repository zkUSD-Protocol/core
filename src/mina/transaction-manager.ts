import { Field, PrivateKey, PublicKey, UInt32, UInt64 } from 'o1js';
import { KeyPair } from '../types/utility.js';
import {
  IncludedTransaction,
  PendingTransaction,
  RejectedTransaction,
  Transaction,
} from 'o1js/dist/node/lib/mina/mina';
import { ZkappCommand } from 'o1js/dist/node/lib/mina/account-update';
import { TrackedPromise } from '../utils/tracked-promise.js';
import { IMinaNetworkInterface } from './mina-network-interface.js';
import { Mutex } from '../utils/mutex.js';
import {
  TransactionStatus,
  mkStatusFailedBeforeSending,
  statusIsFailed,
  statusShouldBeWaitedFor,
} from './transaction-status.js';
import {
  ITransactionExecutor,
  PreparedTransaction,
  TransactionLifecycle,
} from './transaction-executor.js';
import { NonceLock } from './nonce-manager.js';

/**
 * Default configuration options for constructing transactions.
 */
export interface DefaultTransactionOptions {
  printTx: boolean;
  extraSigners: PrivateKey[];
  startingFee: UInt64;
  feeFetcher: (args: {
    tx: Transaction<true, false>;
    failedFee: UInt64;
  }) => Promise<UInt64>;
  printAccountUpdates: boolean;
  dependencyStatusPollInterval: number;
  dependencyStatusPollTimeout: number;
  memo: string;
}

/**
 * Transaction options that allow partial overrides of the default configuration.
 */
export type TransactionOptions = Partial<DefaultTransactionOptions>;

/**
 * Default transaction options with reasonable initial values.
 */
export const defaultOptions: DefaultTransactionOptions = {
  printTx: false,
  extraSigners: [],
  startingFee: new UInt64(0.01e9),
  feeFetcher: async ({ failedFee }) => {
    return failedFee.add(new UInt64(0.01e9));
  },
  printAccountUpdates: false,
  dependencyStatusPollInterval: 2000,
  dependencyStatusPollTimeout: 300000,
  memo: '',
};

/**
 * Describes a transaction request, including the sender, the main execution callback,
 * and any additional configuration options or dependencies.
 */
export type TransactionRequest = {
  name?: string;
  /**
   * TODO: future: avoid passing the private key
   */
  sender: KeyPair;
  callback: () => Promise<void>;
  options: TransactionOptions;
  /**
   * Transactions that must be included before this one can proceed.
   */
  waitForIncluded: (string | TransactionHandle)[];
  callSite: string;
};

/**
 * Represents a minimal handle for accessing transaction metadata.
 */
export interface TransactionHandle {
  readonly txId: string;
  readonly txStatus: TransactionStatus;
  readonly nonce: UInt32 | undefined;
  readonly sender: PublicKey;

  awaitStatusChange(args: {
    until: (status: TransactionStatus) => boolean;
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<TransactionStatus>;

  awaitIncluded(args?: {
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<IncludedTransaction>;
}
/**
 * A proven transaction disallows direct `send` or `sign` to avoid accidental usage.
 */
export type ProvenTransaction = Omit<Transaction<true, false>, 'send' | 'sign'>;

/**
 * Internal representation of a transaction, holding its request, status, and associated promises.
 */
export class TransactionInternal {
  private _request?: TransactionRequest;
  private _callSiteNonce = 0;
  private _dependentTxIds: string[] = [];

  public status: TransactionStatus = 'Scheduled';

  private _signingPromise?: TrackedPromise<Transaction<false, true>>;

  private _sendingPromise?: TrackedPromise<
    PendingTransaction | RejectedTransaction
  >;
  private _waitingPromise?: TrackedPromise<
    IncludedTransaction | RejectedTransaction | undefined
  >;
  private _provingPromise?: TrackedPromise<ProvenTransaction>;

  /**
   * Retrieves the most up-to-date transaction state from whichever promise has been fulfilled.
   */
  public get transactionState():
    | ProvenTransaction
    | PendingTransaction
    | RejectedTransaction
    | IncludedTransaction
    | Transaction<false, true>
    | undefined {
    if (
      this._waitingPromise?.state === 'fulfilled' &&
      this._waitingPromise.result
    ) {
      return this._waitingPromise.result;
    }
    if (this._sendingPromise?.state === 'fulfilled') {
      return this._sendingPromise.result;
    }
    if (this._provingPromise?.state === 'fulfilled') {
      return this._provingPromise.result;
    }
    if (this._signingPromise?.state === 'fulfilled') {
      return this._signingPromise.result;
    }
    return undefined;
  }

  /**
   * Returns the transaction hash if available.
   */
  public get hash(): string | undefined {
    return this.transactionState && 'hash' in this.transactionState
      ? this.transactionState.hash
      : undefined;
  }

  /**
   * Constructs an internal transaction from a TransactionRequest.
   */
  public static fromRequest(
    request: TransactionRequest,
    callSiteNonce = 0
  ): TransactionInternal {
    const tx = new TransactionInternal();
    tx._request = request;
    tx._callSiteNonce = callSiteNonce;
    tx._dependentTxIds = request.waitForIncluded.map((dep) =>
      typeof dep === 'string' ? dep : dep.txId
    );
    return tx;
  }

  /**
   * Accessor for the sender public key.
   */
  public get sender(): PublicKey {
    if (!this.request) {
      throw new Error('TODO - implement sender for non-request transactions');
    }
    return this.request.sender.publicKey;
  }

  /**
   * Attempts to extract the current nonce from the transaction state.
   */
  public get nonce(): UInt32 | undefined {
    const state = this.transactionState;
    if (state && 'transaction' in state) {
      const zkappCommand = state.transaction as ZkappCommand;
      return zkappCommand.feePayer.body.nonce;
    }
    return undefined;
  }

  /**
   * Returns the associated TransactionRequest, if any.
   */
  public get request(): TransactionRequest | undefined {
    return this._request;
  }

  /**
   * Generates a textual ID for the transaction, either from its name or the call site.
   */
  public getId(): string {
    if (this.request?.name) {
      return this.request.name;
    }
    if (this.request) {
      const postfix = this._callSiteNonce ? `_${this._callSiteNonce}` : '';
      return this.request.callSite + postfix;
    }
    throw new Error('TODO - implement getId() for non-request transactions');
  }

  /**
   * Returns an array of transaction dependency IDs, if any.
   */
  public get dependencies(): { txId: string }[] {
    return this._dependentTxIds.map((txId) => ({ txId }));
  }

  /**
   * Installs the promises for proving, sending, and waiting on this transaction.
   */
  public installLifecycle(txLifecycle: TransactionLifecycle): void {
    this._provingPromise = txLifecycle.provingPromise;
    this._sendingPromise = txLifecycle.sendingPromise;
    this._waitingPromise = txLifecycle.waitingPromise;
    // this._sendingPromiseMaker = args.mkSendingPromise;
  }

  /**
   * Polls the `status` property at regular intervals until `stopWaiting(status)` is true or a timeout is reached.
   */
  public async awaitStatusChange(args: {
    until: (status: TransactionStatus) => boolean;
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<TransactionStatus> {
    let { until } = args;
    const timeout = args.timeout ?? defaultOptions.dependencyStatusPollTimeout;
    const statusPollInterval =
      args.statusPollInterval ?? defaultOptions.dependencyStatusPollInterval;

    let currentStatus = this.status;
    const startTime = Date.now();

    while (!until(currentStatus)) {
      if (Date.now() - startTime >= timeout) {
        throw new Error(
          `${this.getId()} Timeout reached while waiting for status change.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, statusPollInterval));
      currentStatus = this.status;
    }

    return currentStatus;
  }

  public async awaitIncluded(args?: {
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<IncludedTransaction> {
    const statusPollInterval =
      args?.statusPollInterval ?? defaultOptions.dependencyStatusPollInterval;
    const timeout = args?.timeout ?? defaultOptions.dependencyStatusPollTimeout;

    const status: TransactionStatus = await this.awaitStatusChange({
      until: (status) => !statusShouldBeWaitedFor(status),
      statusPollInterval,
      timeout,
    });
    if (status !== 'Included') {
      throw new Error(
        `Transaction '${this.getId()}' was not included and ended with status ${JSON.stringify(
          status,
          null,
          2
        )}`
      );
    }
    return this.transactionState as IncludedTransaction;
  }

  /**
   * Provides a minimal handle to monitor transaction state.
   */
  public get handle(): TransactionHandle {
    const self = this;
    return {
      get txId() {
        return self.getId();
      },
      get txStatus(): TransactionStatus {
        return self.status;
      },
      get nonce(): UInt32 | undefined {
        return self.nonce;
      },
      get sender(): PublicKey {
        return self.sender;
      },

      awaitStatusChange: self.awaitStatusChange.bind(self),

      awaitIncluded: self.awaitIncluded.bind(self),
    };
  }

  // Private constructor to force usage of static methods
  private constructor() {}
}

//  Do not call from concurrent threads
export class TransactionManager {
  private _o1jsMutex: Mutex = new Mutex();
  private _mina: IMinaNetworkInterface;

  // in theory you can change the executor without interrupting
  // transacton manager
  public transactionExecutor: ITransactionExecutor;

  public get mina(): IMinaNetworkInterface {
    return this._mina;
  }

  /**
   * There should only be one TransactionManager per chain.
   * TODO: use singleton map here?
   */
  public static new(
    minaInterface: IMinaNetworkInterface,
    transactionExecutor: ITransactionExecutor
  ): TransactionManager {
    return new TransactionManager(minaInterface, transactionExecutor);
  }

  private transactions: Map<string, TransactionInternal> = new Map();
  private _callSiteNonces: Map<string, number> = new Map();

  private getCallSiteNonce(callSite: string): number {
    const r = this._callSiteNonces.get(callSite) ?? 0;
    this._callSiteNonces.set(callSite, r + 1);
    return r;
  }

  txHandle(txId: string): TransactionHandle | undefined {
    return this.transactions.get(txId)?.handle;
  }

  // this will create a new transaction
  // and schedule it for proving signing and sending
  // it will also await for the dependencies to be included or failed
  // it will throw if tx cannot be created or is missing dependencies
  // the interaction with the transaction is done through the returned handle
  // TODO:
  // it will take care of nonce, and fee
  // if the fee is too low, it will retry with higher fee
  // the transaction will be retried until it is included or failed
  // or timed out
  // do not call concurrently
  async tx(
    sender: KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
    },
    callDepth = 2
  ): Promise<TransactionHandle> {
    const { name, waitForIncluded } = options ?? {};

    //===
    // prepare and verify transaction request as scheduled by function user
    const request: TransactionRequest = {
      name,
      sender,
      callback,
      options: options ?? {},
      waitForIncluded: waitForIncluded ?? [],
      callSite: getCallSite(callDepth),
    };

    // dependencies must be met
    const deps: TransactionInternal[] = [];
    for (const depId of request.waitForIncluded) {
      const dep = this.transactions.get(
        typeof depId === 'string' ? depId : depId.txId
      );
      if (!dep) {
        throw new Error(`Transaction ${depId} does not exist`);
      }
      deps.push(dep);
    }

    // name must be unique if it is provided
    if (request.name) {
      if (this.transactions.has(request.name)) {
        throw new Error(`Transaction with name ${request.name} already exists`);
      }
    }
    //=== the request is assumed to be valid at this point

    //=== include the transaction in the manager
    // -- create the tx and add it to the manager
    const tx = TransactionInternal.fromRequest(
      request,
      this.getCallSiteNonce(request.callSite)
    );
    this.transactions.set(tx.getId(), tx);
    // --

    //=== the transaction is included in the manager at this point
    // const failed_before_sending = (phase: string, error: unknown) =>
    const failed_before_sending = (phase: string, error: unknown) => {
      return mkStatusFailedBeforeSending(tx.getId(), phase, error);
    };

    // schedule waiting for dependencies to be included
    const depsAwaitingPromise = new TrackedPromise(async () => {
      try {
        if (tx.dependencies.length !== 0) {
          tx.status = {
            kind: 'AwaitingForOtherTx',
            txs: tx.dependencies.map((dep) => dep.txId),
          };
        }
        await Promise.all(
          deps.map(async (dep) => {
            const depStatus = await dep.awaitStatusChange({
              until: (status) =>
                status === 'Included' || statusIsFailed(status),
              statusPollInterval: options?.dependencyStatusPollInterval,
              timeout: options?.dependencyStatusPollTimeout,
            });
            if (depStatus !== 'Included') {
              throw {
                kind: 'DependencyRejectedFailedOrDropped',
                depId: dep.getId(),
                depStatus,
              };
            }
            return;
          })
        );
        tx.status = 'Scheduled';
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'kind' in error) {
          throw error;
        }
        throw failed_before_sending('awaiting for the tx dependencies', error);
      }
    });

    const builtTx = await transactionBuild(
      this._o1jsMutex,
      this.mina,
      sender,
      callback,
      options
    );

    const mgr = this;
    const mkSigningPromise = <T extends boolean>(
      fee: UInt64,
      unsignedTx: Transaction<T, false>
    ) => {
      return new TrackedPromise(async () => {
        let nonceLock: NonceLock | undefined;
        try {
          try {
            nonceLock = await mgr.mina.nonceManager.getAccountNonce(
              sender.publicKey
            );
          } catch (error) {
            const err = `Error during getting the tx nonce: ${error}`;
            console.error(err);
            throw err;
          }
          unsignedTx.transaction.feePayer.body.nonce = nonceLock.nonce;
          unsignedTx.transaction.feePayer.body.fee = fee;
          if (options?.printTx) {
            console.log(
              `${tx.getId()} - Signing transaction: {nonce: ${
                nonceLock.nonce
              }, fee: ${fee}} ...`
            );
          }

          // TODO use signing service instead, do not pass private keys around
          const signers = options?.extraSigners
            ? [sender.privateKey, ...options.extraSigners]
            : [sender.privateKey];
          return { signedTx: unsignedTx.sign(signers), nonceLock };
        } catch (error) {
          nonceLock?.unlock();
          throw failed_before_sending('signing the tx', error);
        }
      });
    };

    //=== prepare promises that will manage the transaction lifecycle

    const preparedTx: PreparedTransaction = {
      getId: () => tx.getId(),
      tx: builtTx,
      depsAwaitingPromise,
      setStatus: (s: TransactionStatus) => {
        tx.status = s;
      },
      mkSigningPromise,
    };

    //=== delegate the rest of execution

    const lifecycle = await this.transactionExecutor.executeTransaction(
      preparedTx,
      {
        o1jsMutex: this._o1jsMutex,
        mina: this.mina,
        startingFee: options?.startingFee ?? defaultOptions.startingFee,
        printTx: options?.printTx,
      }
    );

    tx.installLifecycle(lifecycle);
    return tx.handle;
  }

  private constructor(
    networkInterface: IMinaNetworkInterface,
    transactionExecutor: ITransactionExecutor
  ) {
    this.transactionExecutor = transactionExecutor;
    this._mina = networkInterface;
  }
}

function getCallSite(depth: number): string {
  let ret = 'unknown_call_site';
  const callerLine = getCallerAtDepth(depth + 1);
  // Regex to extract function name, file path, line, and column
  const match =
    callerLine.match(/at (.+?) \((.+?):(\d+):(\d+)\)/) ||
    callerLine.match(/at (.+?):(\d+):(\d+)/);

  if (match) {
    // Extract details, including function name (if available)
    const functionName = match[1] || 'anonymous';
    const filePath = match[2];
    const line = match[3];
    // const column = match[4];

    // Generate a unique ID string
    ret = `${functionName}_${filePath}:${line}`;
  } else {
    ret = callerLine;
  }

  return ret;
}

function getCallerAtDepth(depth: number = 1): string {
  const error = new Error();
  const stack = error.stack?.split('\n');

  if (stack && stack.length > depth + 1) {
    const callerLine = stack[depth + 1].trim(); // Depth + 1 because stack[0] is the current function
    return callerLine;
  }
  throw new Error('Failed to get caller: stack not deep enough');
}

// DEV: possibly refactor later
// it does not send the transaction to the network
export async function transactionBuild(
  mutex: Mutex,
  chain: IMinaNetworkInterface,
  sender: KeyPair,
  callback: () => Promise<void>,
  options: TransactionOptions & {
    nonce?: UInt32;
    forceFetchAllTxParties?: (
      tx: Record<string, any> & { transaction: ZkappCommand }
    ) => Promise<void>;
  } = {}
): Promise<Transaction<false, false>> {
  const {
    printTx = false,
    startingFee,
    printAccountUpdates = false,
    nonce,
    memo,
  } = options;

  const tx = await mutex.runExclusive(
    async () =>
      await chain.transaction(
        {
          sender: sender.publicKey,
          ...(startingFee && { fee: startingFee }),
          ...(nonce && { nonce: Number(nonce) }),
          ...(memo && { memo }),
        },
        callback
      )
  );

  if (printTx) {
    console.log(tx.toPretty());
  }

  if (printAccountUpdates) {
    const auCount: { publicKey: PublicKey; tokenId: Field; count: number }[] =
      [];
    let proofAuthorizationCount = 0;
    for (const au of tx.transaction.accountUpdates) {
      const { publicKey, tokenId, authorizationKind } = au.body;
      if (au.authorization.proof) {
        proofAuthorizationCount++;
        if (authorizationKind.isProved.toBoolean() === false)
          console.error('Proof authorization exists but isProved is false');
      } else if (authorizationKind.isProved.toBoolean() === true)
        console.error('isProved is true but no proof authorization');
      const index = auCount.findIndex(
        (item) =>
          item.publicKey.equals(publicKey).toBoolean() &&
          item.tokenId.equals(tokenId).toBoolean()
      );
      if (index === -1) auCount.push({ publicKey, tokenId, count: 1 });
      else auCount[index].count++;
    }
    console.log(
      `Account updates for tx: ${auCount.length}, proof authorizations: ${proofAuthorizationCount}`
    );
    for (const au of auCount) {
      if (au.count > 1) {
        console.log(
          `DUPLICATE AU: ${au.publicKey.toBase58()} tokenId: ${au.tokenId.toString()} count: ${
            au.count
          }`
        );
      }
    }
    console.log(tx.transaction.accountUpdates);
  }
  return tx;
}
