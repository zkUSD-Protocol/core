import { Field, PrivateKey, PublicKey, TransactionPromise, UInt32, UInt64 } from "o1js";
import { KeyPair } from "../types";
import { FeePayerSpec, PendingTransaction, RejectedTransaction, Transaction } from "o1js/dist/node/lib/mina/mina";


interface TxApiProvider {
    transaction(sender: FeePayerSpec, f: () => Promise<void>): TransactionPromise<false, false>;
    getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32>;
}

type DefaultTransactionOptions = {
  printTx: boolean
  extraSigners: PrivateKey[];
  startingFee: UInt64;
  feeFetcher: (args: { tx: Transaction<true, false>, failedFee: UInt64 }) => Promise<UInt64>;
  printAccountUpdates: boolean;
  dependencyStatusPollInterval: number;
  dependencyStatusPollTimeout: number;
}
type TransactionOptions = Partial<DefaultTransactionOptions>;


const defaultOptions: DefaultTransactionOptions = {
  printTx: false,
  extraSigners: [],
  startingFee: new UInt64(0.01e9),
  feeFetcher: async ({failedFee}) => {
    return failedFee.add(new UInt64(0.01e9));
  },
  printAccountUpdates: false,
  dependencyStatusPollInterval: 2000,
  dependencyStatusPollTimeout: 30000
}

export type TransactionRequest = {
  name?: string;
  sender: KeyPair; // TODO: future: avoid passing the private key
  callback: () => Promise<void>;
  options: TransactionOptions;
  waitForIncluded: string[];
  callSite: string;
}

interface TransactionHandle {
  readonly txId: string;
  readonly txStatus: TransactionStatus;
  readonly nonce: UInt32 | undefined;
  readonly sender: PublicKey;
}

export type AwaitingForOtherTx = {
  kind: "AwaitingForOtherTx";
  txs: string[];
}

export type RetryingWithHigherFee = {
  kind: "RetryingWithHigherFee";
  failureCount: number;
}

export type ScheduledForCancellation = {
  kind: "ScheduledForCancellation";
  cancellationTx: string;
}

export type DependencyRejectedFailedOrDropped = {
  kind: "DependencyRejectedFailedOrDropped";
  depId: string;
  depStatus: TransactionStatus;
}

type ProcessingTxStatus
  = "Scheduled"
  | AwaitingForOtherTx
  | "Pending"
  | ScheduledForCancellation
  | RetryingWithHigherFee

type FailedTxStatus
  = "Rejected"
  | "Cancelled"
  | "DroppedFromMempool"
  | DependencyRejectedFailedOrDropped;

export type TransactionStatus
  = ProcessingTxStatus
  | FailedTxStatus
  | "StuckInMempool"  // when timed out on waiting: may be problematic, should it be treated as failed?
  | "Included";

function statusShouldBeWaitedFor(status: TransactionStatus): boolean {
  const ss = ["Scheduled", "Pending", "StuckInMempool", "AwaitingForOtherTx", "ScheduledForCancellation", "RetryingWithHigherFee"];
  if (typeof status === "object" && status !== null) {
    return ss.includes(status.kind);
  }
  return ss.includes(status);
}

function statusIsFailed(status: TransactionStatus): status is FailedTxStatus {
  if (typeof status === "string") {
    // Check if the status is one of the string literals in FailedTxStatus
    return ["Rejected", "Cancelled", "DroppedFromMempool"].includes(status);
  }

  // Check if the status is one of the objects in FailedTxStatus
  if (typeof status === "object" && status !== null) {
    return status.kind === "DependencyRejectedFailedOrDropped";
  }

  return false;
}


class TransactionInternal {
  private _request?: TransactionRequest;
  private _callSiteNonce: number;
  private _dependentTxs: {txId: string, statusCallback: (status: TransactionStatus) => void}[] = [];
  private _status: TransactionStatus = "Scheduled";
  private _pendingTransaction?: PendingTransaction | RejectedTransaction;


  private constructor() {}

  public get sender(): PublicKey {
    if (!this.request) {
      throw new Error("TODO - implement sender for non-request transactions");
    }
    return this.request.sender.publicKey;
  }

  public get nonce() : UInt32 | undefined {
    return this._pendingTransaction?.transaction.feePayer.body.nonce;
  }

  public get request(): TransactionRequest | undefined {
    return this._request;
  }

  public getId(): string {
    if (this.request?.name) {
      return this.request.name;
    }
    else if (this.request) {
      const postfix = this._callSiteNonce ? `_${this._callSiteNonce}` : "";
      return this.request.callSite + postfix;
    }
    throw new Error("TODO - implement getId() for non-request transactions");
  }

  public static fromRequest(request: TransactionRequest, callSiteNonce: number = 0): TransactionInternal {
    const tx = new TransactionInternal();
    tx._request = request;
    tx._callSiteNonce = callSiteNonce;
    return tx;
  }

  public bumpNonce(): void {
    this._callSiteNonce++;
  }

  public addDependentTxs(txs: {txId: string, statusCallback: (status: TransactionStatus) => void}[]): void {
    this._dependentTxs.push(...txs);
  }


  public get status(): TransactionStatus {
    return this._status;
  }

  public set status(status: TransactionStatus) {
    this._status = status;
    this.onStatusChange()
  }

  private onStatusChange(): void {
    // update dependent transactions
    this._dependentTxs.forEach(({ statusCallback }) => {
      statusCallback(this.status);
    });
  }

  /**
   * Waits for a transaction status change until a specified condition is met or a timeout is reached.
   *
   * This method polls the `status` property at regular intervals and evaluates the provided `stopWaiting`
   * function on the current status. If the condition defined by `stopWaiting` returns `true`, the method
   * resolves with the current status. If the timeout is reached before the condition is met, an error is thrown.
   *
   * @param stopWaiting - A callback function that evaluates the current status. The polling stops
   *                      when this function returns `true`.
   * @param statusPollInterval - The interval, in milliseconds, between each polling attempt.
   *                             Default is 2000ms (2 seconds).
   * @param timeout - The maximum duration, in milliseconds, to wait for the condition to be met.
   *                  If the timeout is reached, the method throws an error. Default is 30000ms (30 seconds).
   * @returns A promise that resolves with the current status when the condition defined by `stopWaiting` is met.
   * @throws An error if the timeout is reached before the condition is satisfied.
   *
   * @example
   * // Example usage:
   * try {
   *   const finalStatus = await transaction.awaitStatusChange(
   *     (status) => status === "included", // Stop waiting when status is "accepted"
   *     2000,                             // Poll every 2 seconds
   *     10000                             // Timeout after 10 seconds
   *   );
   *   console.log("Transaction status changed to:", finalStatus);
   * } catch (error) {
   *   console.error("Timeout or error while waiting for status change:", error.message);
   * }
   */
  public async awaitStatusChange(
    stopWaiting: (status: TransactionStatus) => boolean,
    statusPollInterval = 2000,
    timeout = 60000
  ): Promise<TransactionStatus> {
    let currentStatus = this.status;
    const startTime = Date.now();

    while (!stopWaiting(currentStatus)) {
      if (Date.now() - startTime >= timeout) {
        throw new Error("Timeout reached while waiting for status change.");
      }

      await new Promise((resolve) => setTimeout(resolve, statusPollInterval)); // Wait for the poll interval
      currentStatus = this.status;
      console.log("Polled status:", currentStatus);
    }

    return currentStatus;
  }






  public dependencyStatusChanged(depId: string, status: TransactionStatus): void {
    console.log(`Transaction ${this.getId()} received status change for dependency ${depId}: ${status}`);
    this.checkDependencies();
  }

  public checkDependencies(): void {
    // if 


    // if all dependencies are included, send the transaction
  }

  private sendTransaction(): void {

  }


  public get handle(): TransactionHandle {
    const tx = this;
    return {
      get txId() {
        return tx.getId();
      },

      get txStatus() : TransactionStatus {
        return tx.status;
      },

      get nonce() : UInt32 {
        return tx.nonce!;
      },

      get sender() : PublicKey {
        return tx.sender;
      }

    }
  }

  public setPendingTransaction(pendingTransaction: PendingTransaction | RejectedTransaction): void {
    this._pendingTransaction = pendingTransaction;
    switch (pendingTransaction.status) {
      case "pending": {
        this.status = "Pending";
        break;
      }
      case "rejected": {
        this.status = "Rejected";
        break;
      }
    }
  }
}


export class TransactionManager {
  private chain: TxApiProvider;

  private transactions: Map<string, TransactionInternal> = new Map();
  private callSiteNonces: Map<string, number> = new Map();


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
  async tx(
    sender: KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
  name?: string,
  options?: TransactionOptions,
  waitForIncluded?: string[]
  ): Promise<TransactionHandle>{

    //===
    // prepare and verify transaction request as scheduled by function user
    const request: TransactionRequest = {
      name,
      sender,
      callback,
      options: options ?? {},
      waitForIncluded: waitForIncluded ?? [],
      callSite: getCallSite(1)
    };

    // name must be unique
    if (request.name) {
      throw new Error(`Transaction with name ${request.name} already exists`);
    }

    // dependencies must be met
    const deps: TransactionInternal[] = []
    for (const depId of request.waitForIncluded) {
      const dep = this.transactions.get(depId);
      if (!dep) {
        throw new Error(`Transaction ${depId} does not exist`);
      }
      deps.push(dep);
    }
    //=== the request is assumed to be valid at this point

    //=== include the transaction in the manager
    // (callSite + callSiteNonce) must be unique
    let callSiteNonce = this.callSiteNonces.get(request.callSite) ?? 0;
    // -- create the tx and add it to the manager
    const tx = TransactionInternal.fromRequest(request, callSiteNonce);
    this.transactions.set(tx.getId(), tx);
    // --
    // increment callSiteNonce - the tx was added
    this.callSiteNonces.set(request.callSite, callSiteNonce + 1);

    // install dependencies
    for (const dep of deps) {
      dep.addDependentTxs([{
        txId: tx.getId(),
        statusCallback: (status: TransactionStatus) => {
          tx.dependencyStatusChanged(dep.getId(), status);
        }
      }]);
    }
    //=== the transaction is included in the manager at this point

    //=== prepare promises that will manager the transaction lifecycle
    const mgr = this;
    // schedule proving
    const provingPromise = transactionBuildAndProve(mgr.chain, sender, callback, options);

    // schedule waiting for dependencies to be included
    const depsAwaitingPromise = Promise.all(deps.map(async (dep) => {
      const depStatus = await dep.awaitStatusChange(
        status => status === "Included" || statusIsFailed(status),
        options?.dependencyStatusPollInterval ?? defaultOptions.dependencyStatusPollInterval,
        options?.dependencyStatusPollTimeout ?? defaultOptions.dependencyStatusPollTimeout);
      if (depStatus !== "Included") {
        throw new Error(`Transaction dependency ${dep.getId()} has failed status ${depStatus}`);
      }
      return;
    }));

    // make a function that will schedule getting nonce and sign
    // because the nonce has higher chance of being wrong at this point
    // so we delay it until the last moment
    const mkSigningPromise = function (fee: UInt64) {
      return async (ptx: Transaction<true, false>) => {
        const nonce = await mgr.chain.getAccountNonce(sender.publicKey);
        ptx.transaction.feePayer.body.nonce = nonce;
        ptx.transaction.feePayer.body.fee = fee;
        console.log("Signing transaction  ...");
        // TODO use signing service instead, do not pass private keys around
        const signers = options?.extraSigners ? [sender.privateKey, ...options.extraSigners] : [sender.privateKey];
        return ptx.sign(signers);
      }
    };

    // create sending promise maker
    const mkSendingPromise = function (fee: UInt64) {
      return async () => {
        const results = await Promise.all([provingPromise, depsAwaitingPromise]);
        const provenTx = results[0];
        const signedTx = await mkSigningPromise(fee)(provenTx);
        // send the transaction
        const sentTx = await signedTx.safeSend();
        switch (sentTx.status) {
          case "pending": {
            tx.status = "Pending";
            break;
          }
          case "rejected": {
            tx.status = "Rejected";
            break;
          }
        }

        tx.status = sentTx.status === "pending" ? "Pending" : "Rejected";
        return sentTx;
      }
    }
    // schedule sending
    const sendingPromise = mkSendingPromise(options?.startingFee ?? defaultOptions.startingFee);

    // schedule waiting for the transaction to be included
    // the future logic is:
    // when waiting times out, the graphql api is asked
    // for the transaction status if it is still in the mempool
    // then we retry with higher fee or leave it with the status
    // of stuck in mempool
    const waitingPromise = async () => {
      const sentTx = await sendingPromise();
      if (sentTx.status === "rejected") return;
      const awaitedTx = await sentTx.safeWait();
      if (awaitedTx.status === "included") {
        tx.status = "Included";
      }
      else {
        // TODO check if actually rejected or stuck in mempool
        // if stuck then retry with higher fee
        console.log("TODO - rejected or stuck in mempool");
        const actualStatus = "rejected";

        if (actualStatus === "rejected") {
          tx.status = "Rejected";
        }
      }
    }

    // TODO indstall promises in the tx
    // TODO install timestamps in the tx


    return tx.handle;
  }


}

function getCallSite(depth: number): string {
  let ret = "unknown_call_site";
  const callerLine = getCallerAtDepth(depth+1);
  // Regex to extract function name, file path, line, and column
  const match = callerLine.match(/at (.+?) \((.+?):(\d+):(\d+)\)/) ||
    callerLine.match(/at (.+?):(\d+):(\d+)/);

  if (match) {
    // Extract details, including function name (if available)
    const functionName = match[1].replace(/[^\w]/g, "_") || "anonymous";
    const filePath = match[2]?.replace(/[^\w]/g, "_");
    const line = match[3];
    const column = match[4];

    // Generate a unique ID string
    ret = `${functionName}_${filePath}_${line}_${column}`;
  }
  else {
    ret = callerLine;
  }

  return ret;
}

function getCallerAtDepth(depth: number = 1): string {
  const error = new Error();
  const stack = error.stack?.split("\n");

  if (stack && stack.length > depth + 1) {
    const callerLine = stack[depth + 1].trim(); // Depth + 1 because stack[0] is the current function
    return callerLine;
  }
  throw new Error("Failed to get caller: stack not deep enough");
}

// DEV: possibly refactor later
// it does not send the transaction to the network
export async function transactionBuildAndProve(
  chain: TxApiProvider,
  sender: KeyPair,
  callback: () => Promise<void>,
  options: TransactionOptions & { nonce?: UInt32 } = {}
): Promise<Transaction<true, false>> {
  const {
    printTx = false,
    startingFee,
    printAccountUpdates = false,
    nonce
  } = options;


  const tx = await chain.transaction(
    {
      sender: sender.publicKey,
      ...(startingFee && { fee: startingFee }),
      ...(nonce && { nonce: Number(nonce) })
    },
    callback
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
          `DUPLICATE AU: ${au.publicKey.toBase58()} tokenId: ${au.tokenId.toString()} count: ${au.count
          }`
        );
      }
    }
    console.log(tx.transaction.accountUpdates);
  }

  try {
    console.log("Proving transaction  ...");
    return await tx.prove();
  } catch (error) {
    console.error("Error during transaction processing:", error);
    throw error; // Propagate the error to the caller
  }

}
