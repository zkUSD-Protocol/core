import {
  Field,
  PrivateKey,
  PublicKey,
  Transaction,
  UInt32,
  UInt64,
} from 'o1js';
import { KeyPair, WithDefault, singleDefault } from '../types/utility.js';
import { TrackedPromise } from '../utils/tracked-promise.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import { Mutex } from '../utils/mutex.js';
import {
  TransactionStatus,
  TxLifecycleStatus,
  mkStatusFailedBeforeSending,
  statusIsChainResolved,
  statusIsFailed,
  statusShouldBeWaitedFor,
} from './status.js';
import {
  ITransactionExecutor,
  PreparedTransaction,
  TransactionArgs,
  TransactionLifecycle,
  TransactionState,
} from './executor.js';
import { zkUsdTransaction } from './execution.js';
import { ZkUsdEngine } from '../system/transaction-config.js';
import { MinaPriceInput } from '../proofs/oracle-price-aggregation/verify.js';
import { Account, isKeyPair, printTxAccountUpdates } from '../mina/utils.js';
import { MinaZkappCommand } from '../o1js-compat/zkappcommand.js';

const DEBUG = !!process.env.DEBUG;
const MUTEX_DEBUG = DEBUG && false; // set to true to debug mutex

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
  statusChangeWaitingIntervalMs: number,
  statusChangeWaitingTimeoutMs: number,
  inclusionAwaitingTimeoutMs: number;
  memo: string;
  refreshAccounts: Account[];
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
  statusChangeWaitingIntervalMs: 1000,
  statusChangeWaitingTimeoutMs: 300000,
  inclusionAwaitingTimeoutMs: 300000,
  memo: '',
  refreshAccounts: [],
};

/**
 * Describes a transaction request, including the sender, the main execution callback,
 * and any additional configuration options or dependencies.
 */
export type TransactionRequest = {
  name: string;
  /**
   * TODO: future: avoid passing the private key
   */
  sender: KeyPair | PublicKey;
  callback: () => Promise<void>;
  options: TransactionOptions;
  /**
   * Transactions that must be included before this one can proceed.
   */
  waitForIncluded: (string | TransactionHandle)[];

  args?: TransactionArgs;
};

/**
 * Represents a minimal handle for accessing transaction metadata.
 */
export interface TransactionHandle {
  readonly txId: string;
  readonly txStatus: TransactionStatus;
  readonly lifecycleStatus: TxLifecycleStatus;
  readonly signedTransaction: Transaction<any, true> | undefined;
  readonly sender: PublicKey;
  readonly hash: string | undefined;
  readonly resolutionBlockHeight: bigint | undefined;

  awaitStatusChange(args: {
    until: (status: TransactionStatus) => boolean;
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<TransactionStatus>;

  awaitIncluded(args?: {
    statusPollInterval?: number;
    timeout?: number;
  }): Promise<void>;

  subscribeToLifecycleChange(cb: (lifecycle: TxLifecycleStatus) => void): void;
}

export type TransactionStatusUpdateCallback = (statuses: {
  lifecycle: TxLifecycleStatus | 'unchanged';
  status: TransactionStatus | 'unchanged';
}) => void;

/**
 * Internal representation of a transaction, holding its request, status, and associated promises.
 */
export class TransactionInternal {
  private _handle: TransactionHandle | undefined;
  private _status: TransactionStatus = 'Scheduled';
  private _lifecycleStatus: TxLifecycleStatus = TxLifecycleStatus.SCHEDULED;
  private _request?: TransactionRequest;
  // this is not a tx nonce, it is just an ordinal number of tx creation call site.
  private _dependentTxIds: string[] = [];
  readonly _statusUpdateCallbacks: TransactionStatusUpdateCallback[];
  readonly _lifecycleUpdateCallbacks: ((
    lifecycle: TxLifecycleStatus
  ) => void)[] = [];

  public signedTransaction?: Transaction<any, true>;
  public get status(): TransactionStatus {
    return this._status;
  }
  public get lifecycleStatus(): TxLifecycleStatus {
    return this._lifecycleStatus;
  }

  public setStatuses(
    status: TransactionStatus | 'unchanged',
    lifecyleStatus: TxLifecycleStatus | 'unchanged'
  ) {
    this._statusUpdateCallbacks.forEach((cb) =>
      cb({ lifecycle: lifecyleStatus, status })
    );
    if (status !== 'unchanged') this._status = status;
    if (lifecyleStatus !== 'unchanged') {
      this._lifecycleStatus = lifecyleStatus;
      this._lifecycleUpdateCallbacks.forEach((cb) => cb(lifecyleStatus));
    }
  }

  private _lifecycle: Partial<TransactionLifecycle> = {};

  /**
   * Retrieves the most up-to-date transaction state from whichever promise has been fulfilled.
   */
  public get transactionState(): TransactionState | undefined {
    if (
      this._lifecycle.waitingPromise?.state === 'fulfilled' &&
      this._lifecycle.waitingPromise.result
    ) {
      return this._lifecycle.waitingPromise.result;
    }
    if (this._lifecycle.sendingPromise?.state === 'fulfilled') {
      return this._lifecycle.sendingPromise.result;
    }
    if (this._lifecycle.provingPromise?.state === 'fulfilled') {
      return this._lifecycle.provingPromise.result;
    }
    return undefined;
  }

  public get resolutionBlockHeight() : bigint|undefined {
    const s = this._lifecycle.waitingPromise;
    if (s?.state === 'fulfilled') {
      if (statusIsChainResolved(this.status) && 'resolutionBlockHeight' in s.result) {
        return s.result.resolutionBlockHeight;
        } else{
          console.error('resolutionBlockHeight not found in chain resolved awaited transaction')
          return undefined
      }
    }
    return undefined;
  }


  /**
   * Returns the transaction hash if available.
   */
  public get hash(): string | undefined {
    const s = this._lifecycle.sendingPromise;
    if (s?.state === 'fulfilled') {
      if (s.result.isLocal) {
        return s.result.transaction.hash;
      } else if ('hash' in s.result) {
        return s.result.hash;
      } else {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Constructs an internal transaction from a TransactionRequest.
   */
  public static fromRequest(
    request: TransactionRequest,
    statusUpdateCallback: () => void,
    defaultOptions: DefaultTransactionOptions
  ): TransactionInternal {
    const tx = new TransactionInternal(defaultOptions, statusUpdateCallback);
    tx._request = request;
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
    if ('publicKey' in this.request.sender) {
      return (this.request.sender as KeyPair).publicKey;
    } else {
      return this.request.sender;
    }
  }

  /**
   * Attempts to extract the current nonce from the transaction state.
   */
  public get nonce(): UInt32 | undefined {
    const state = this.transactionState;
    if (state && 'transaction' in state) {
      const zkappCommand = state.transaction as MinaZkappCommand;
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
    this._lifecycle = txLifecycle;
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
    const timeout = args.timeout ?? this._defaultOptions.statusChangeWaitingTimeoutMs;
    const statusPollInterval =
      args.statusPollInterval ?? this._defaultOptions.statusChangeWaitingIntervalMs;

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
  }): Promise<void> {
    const statusPollInterval =
      args?.statusPollInterval ?? this._defaultOptions.statusChangeWaitingIntervalMs;
    const timeout = args?.timeout ?? this._defaultOptions.statusChangeWaitingTimeoutMs;

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
  }

  public subscribeToLifecycleChange(
    cb: (lifecycle: TxLifecycleStatus) => void
  ): void {
    this._lifecycleUpdateCallbacks.push(cb);
  }

  /**
   * Provides a minimal handle to monitor transaction state.
   */
  public get handle(): TransactionHandle {
    if (this._handle) return this._handle;
    const self = this;
    this._handle = {
      get hash() {
        return self.hash;
      },
      get txId() {
        return self.getId();
      },
      get txStatus(): TransactionStatus {
        return self.status;
      },
      get signedTransaction(): Transaction<any, true> | undefined {
        return self.signedTransaction;
      },
      get sender(): PublicKey {
        return self.sender;
      },
      get lifecycleStatus(): TxLifecycleStatus {
        return self.lifecycleStatus;
      },
      get resolutionBlockHeight(): bigint | undefined {
        return self.resolutionBlockHeight;
      },
      awaitStatusChange: self.awaitStatusChange.bind(self),

      awaitIncluded: self.awaitIncluded.bind(self),

      subscribeToLifecycleChange: self.subscribeToLifecycleChange.bind(self),
    };
    return this._handle;
  }

  // Private constructor to force usage of static methods
  private constructor(
    readonly _defaultOptions: DefaultTransactionOptions,
    readonly _statusUpdateCallback?: TransactionStatusUpdateCallback
  ) {
    this._statusUpdateCallbacks = _statusUpdateCallback
      ? [_statusUpdateCallback]
      : [];
  }
}

//  Do not call from concurrent threads
export class TransactionManager<E extends string> {
  private _o1jsMutex: Mutex = new Mutex(
    MUTEX_DEBUG ? 'txmgr-O1jsMutex' : undefined
  );

  private _txMethodMutex: Mutex = new Mutex(
    MUTEX_DEBUG ? 'txmgr-O1jsMutex' : undefined
  );

  private _mina: IMinaNetworkInterface;

  private readonly statusSubscribers: Map<
    string,
    (txs: TransactionHandle[]) => void
  > = new Map();

  private transactionStatusChanged() {
    this.statusSubscribers.forEach((cb) => cb(this.transactionHandles));
  }
  // ---------------------
  public transactionOptions: DefaultTransactionOptions = defaultOptions;

  public get transactionHandles(): TransactionHandle[] {
    return Array.from(this.transactions.values()).map((tx) => tx.handle);
  }

  public subscribeToTransactionStatusChanges(
    cb: (txs: TransactionHandle[]) => void
  ) {
    // new random hash
    const key =
      Date.now().toString(36) + Math.random().toString(36).substring(2);
    this.statusSubscribers.set(key, cb);
  }

  public unsubscribeFromTransactionStatusChanges(key: string) {
    this.statusSubscribers.delete(key);
  }

  // in case you need to build or prove tx outside of tx mgr
  public get o1jsMutex(): Mutex {
    return this._o1jsMutex;
  }

  // in theory you can change the executor without interrupting
  // transacton manager
  public transactionExecutors: WithDefault<E, ITransactionExecutor>;

  public get mina(): IMinaNetworkInterface {
    return this._mina;
  }

  /**
   * There should only be one TransactionManager per chain.
   * TODO: use singleton map here?
   */
  public static new<E extends string>(
    minaInterface: IMinaNetworkInterface,
    transactionExecutors:
      | WithDefault<E, ITransactionExecutor>
      | { [K in E]: ITransactionExecutor },
    overrideOptions?: TransactionOptions
  ): TransactionManager<E> {
    let executor: WithDefault<E, ITransactionExecutor>;

    // if transactionExecutors satisfies the interface
    if ('default' in transactionExecutors) {
      executor = transactionExecutors as WithDefault<E, ITransactionExecutor>;
    } else {
      const firstKey = Object.keys(transactionExecutors)[0] as E;
      const firstValue = Object.values(transactionExecutors)[0];

      executor = singleDefault(firstKey, firstValue as ITransactionExecutor);
    }

    return new TransactionManager(minaInterface, executor,overrideOptions);
  }

  private transactions: Map<string, TransactionInternal> = new Map();

  txHandle(txId: string): TransactionHandle | undefined {
    return this.transactions.get(txId)?.handle;
  }

  async engineTx(
    sender: KeyPair | PublicKey,
    args: TransactionArgs,
    engine: InstanceType<ZkUsdEngine>,
    minaPriceInput?: MinaPriceInput | undefined,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
      executor?: E;
    }
  ) {
    const senderKey = isKeyPair(sender) ? sender.publicKey : sender;
    const { callback } = await zkUsdTransaction({
      kind: args.transactionType,
      sender: senderKey,
      txArgs: args.args,
      engine,
      accountsUpToDate: true,
      minaPriceInput,
    });
    if (!options?.name) {
      const name = args.args.transactionId;
      return await this.tx(sender, callback, { ...options, name }, args);
    }
    return await this.tx(sender, callback, options, args);
  }

  // this will create a new transaction
  // and schedule it for proving signing and sending
  // it will also await for the dependencies to be included or failed
  // it will throw if tx cannot be created or is missing dependencies
  // the interaction with the transaction is done through the returned handle
  // it will take care of nonce
  // TODO:
  // if the fee is too low, it should retry with higher fee
  // the transaction should be retried until it is included or failed
  // or timed out
  async tx(
    sender: KeyPair | PublicKey, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
      executor?: E;
    },
    args?: TransactionArgs
  ): Promise<TransactionHandle> {
    return await this._txMethodMutex.runExclusive(async () => {
      const { waitForIncluded } = options ?? {};
      let name = options?.name;

      if (!name) {
        let i = 1;
        while (true) {
          if (this.transactions.has(`tx${i}`)) {
            i = i + 1;
          } else {
            name = `tx${i}`;
            break;
          }
        }
      }

      // prepare and verify transaction request as scheduled by function user
      const request: TransactionRequest = {
        name,
        sender,
        callback,
        options: options ?? {},
        waitForIncluded: waitForIncluded ?? [],
        args,
      };

      // dependencies must be met
      const deps: TransactionInternal[] = [];
      for (const mDepId of request.waitForIncluded) {
        const depId = typeof mDepId === 'string' ? mDepId : mDepId.txId;
        const dep = this.transactions.get(depId);
        if (!dep) {
          throw new Error(`Transaction ${depId} does not exist`);
        }
        deps.push(dep);
      }

      // name must be unique if it is provided
      if (request.name) {
        if (this.transactions.has(request.name)) {
          throw new Error(
            `Transaction with name ${request.name} already exists`
          );
        }
      }
      //=== the request is assumed to be valid at this point

      //=== include the transaction in the manager
      // -- create the tx and add it to the manager
      const tx = TransactionInternal.fromRequest(
        request,
        this.transactionStatusChanged.bind(this),
        this.transactionOptions
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
            tx.setStatuses(
              {
                kind: 'AwaitingForOtherTx',
                txs: tx.dependencies.map((dep) => dep.txId),
              },
              TxLifecycleStatus.AWAITING_DEPENDENCIES
            );
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
          tx.setStatuses('Scheduled', TxLifecycleStatus.PREPARING);
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            throw error;
          }
          throw failed_before_sending(
            'awaiting for the tx dependencies',
            error
          );
        }
      });

      let buildOptions: TransactionOptions & {
        nonce?: UInt32;
        forceFetchAllTxParties: (
          tx: Record<string, any> & { transaction: MinaZkappCommand }
        ) => Promise<void>;
      } = {
        ...options,
        forceFetchAllTxParties: this.mina.forceFetchAllTxParties.bind(
          this.mina
        ),
      };

      const builtTxPromise = depsAwaitingPromise.then(async () => {
        try {
          for (const acc of options?.refreshAccounts ?? []) {
            await this.mina.fetchMinaAccount(acc.publicKey, {
              tokenId: acc.tokenId,
              force: true,
            });
          }

          const builtTx = await transactionBuild(
            this._o1jsMutex,
            this.mina,
            extractPublicKey(sender),
            callback,
            buildOptions
          );
          return builtTx;
        } catch (error) {
          throw failed_before_sending('building the tx', error);
        }
      });

      //=== prepare promises that will manage the transaction lifecycle
      const nonceLock = this.mina.nonceManager.getAccountNonce.bind(
        this.mina.nonceManager
      );

      const preparedTx: PreparedTransaction = {
        getId: () => tx.getId(),
        args: tx.request?.args ?? undefined,
        buildTx: builtTxPromise,
        setStatuses: (
          s: TransactionStatus | 'unchanged',
          lcs: TxLifecycleStatus | 'unchanged'
        ) => {
          tx.setStatuses(s, lcs);
        },
        keys: { sender, extraSigners: options?.extraSigners ?? [] },
        nonceLock,
      };

      //=== delegate the rest of execution
      const executorKey =
        options?.executor ?? this.transactionExecutors.default;
      const txExecutor = this.transactionExecutors[executorKey];

      const lifecycle = await txExecutor.executeTransaction(preparedTx, {
        o1jsMutex: this._o1jsMutex,
        mina: this.mina,
        startingFee: options?.startingFee ?? this.transactionOptions.startingFee,
        printTx: options?.printTx,
        inclusionAwaitingTimeoutMs:
          options?.inclusionAwaitingTimeoutMs ??
          this.transactionOptions.inclusionAwaitingTimeoutMs,
      });

      tx.installLifecycle(lifecycle);
      return tx.handle;
    });
  }

  private constructor(
    networkInterface: IMinaNetworkInterface,
    transactionExecutors: WithDefault<E, ITransactionExecutor>,
    overrideOption?: TransactionOptions
  ) {
    this.transactionExecutors = transactionExecutors;
    this._mina = networkInterface;
    this.transactionOptions = { ...defaultOptions, ...overrideOption};
  }
}

// DEV: possibly refactor later
// it does not send the transaction to the network
export async function transactionBuild(
  mutex: Mutex,
  chain: IMinaNetworkInterface,
  sender: PublicKey,
  callback: () => Promise<void>,
  options: TransactionOptions & {
    nonce?: UInt32;
    forceFetchAllTxParties: (
      tx: Record<string, any> & { transaction: MinaZkappCommand }
    ) => Promise<void>;
  }
): Promise<Transaction<false, false>> {
  const {
    printTx = false,
    startingFee,
    printAccountUpdates = false,
    nonce,
    memo,
  } = options;

  let tx = await mutex.runExclusive(
    async () =>
      await chain.transaction(
        {
          sender: sender,
          ...(startingFee && { fee: startingFee }),
          ...(nonce && { nonce: Number(nonce) }),
          ...(memo && { memo }),
        },
        callback
      )
  );

  await options.forceFetchAllTxParties(tx);

  // now we're sure that all constraints are up to date.
  tx = await mutex.runExclusive(
    async () =>
      await chain.transaction(
        {
          sender: sender,
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

  if (printAccountUpdates) printTxAccountUpdates(tx);
  return tx;
}

function extractPublicKey(x: KeyPair | PublicKey) {
  if ('publicKey' in x) {
    return (x as KeyPair).publicKey;
  } else {
    return x;
  }
}
