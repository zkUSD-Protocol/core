import { Field, PrivateKey, PublicKey, TransactionPromise, UInt32 } from "o1js";
import { KeyPair } from "../types";
import { FeePayerSpec, PendingTransaction } from "o1js/dist/node/lib/mina/mina";


interface TxApiProvider {
    transaction(sender: FeePayerSpec, f: () => Promise<void>): TransactionPromise<false, false>;
}

interface TransactionOptions {
  printTx?: boolean;
  extraSigners?: PrivateKey[];
  fee?: number;
  printAccountUpdates?: boolean;
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
  | "StuckInMempool"  // may be problematic, should it be treated as failed?
  | "Included";

function isFailedTxStatus(status: TransactionStatus): status is FailedTxStatus {
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
  private _nonce? : UInt32;
  private _status: TransactionStatus = "Scheduled";
  private _pendingTransaction?: PendingTransaction;


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

  private set status(status: TransactionStatus) {
    this._status = status;
    this.onStatusChange()
  }

  private onStatusChange(): void {
    // update dependent transactions
    this._dependentTxs.forEach(({ statusCallback }) => {
      statusCallback(this.status);
    });
  }

  public dependencyStatusChanged(depId: string, status: TransactionStatus): void {
    throw new Error("TODO - implement dependencyStatusChanged");
  }

  public get handle(): TransactionHandle {
    const tx = this;
    return {
      get txId() {
        return tx.getId();
      },

      get txStatus() : TransactionStatus {
        return "Pending";
      },

      get nonce() : UInt32 {
        return tx._nonce!;
      },

      get sender() : PublicKey {
        return tx.sender;
      }

    }
  }
}


export class TransactionManager {
  private chain: TxApiProvider;

  private transactions: Map<string, TransactionInternal> = new Map();
  private callSiteNonces: Map<string, number> = new Map();


  async tx(
    sender: KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
  name?: string,
  options?: TransactionOptions,
  waitForIncluded?: [string]
  ): Promise<TransactionHandle>{
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
    const deps = []
    for (const depId of request.waitForIncluded) {
      const dep = this.transactions.get(depId);
      if (!dep) {
        throw new Error(`Transaction ${depId} does not exist`);
      }
      deps.push(dep);
    }
    // none of dependencies can have a failed status
    for (const dep of deps) {
      if (isFailedTxStatus(dep.status)) {
        throw new Error(`Transaction dependency ${dep.getId()} has failed status ${dep.status}`);
      }
    }

    // (callSite + callSiteNonce) must be unique
    let callSiteNonce = this.callSiteNonces.get(request.callSite) ?? 0;
    // -- create the tx and add it to the manager
    const tx = TransactionInternal.fromRequest(request, callSiteNonce);
    this.transactions.set(tx.getId(), tx);
    // ---
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

    const sentTx = await transaction(this.chain, sender, callback, options);

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


export async function transaction(
  chain: TxApiProvider,
  sender: KeyPair,
  callback: () => Promise<void>,
  options: TransactionOptions = {}
) {
  const {
    printTx = false,
    extraSigners = [],
    fee,
    printAccountUpdates = false,
  } = options;



  const tx = await chain.transaction(
    {
      sender: sender.publicKey,
      ...(fee && { fee }),
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
          `DUPLICATE AU: ${au.publicKey.toBase58()} tokenId: ${au.tokenId.toString()} count: ${
            au.count
          }`
        );
      }
    }
    console.log(tx.transaction.accountUpdates);
  }

  console.log("Proving transaction...");
  await tx.prove();

  // TODO replace with signing service sign
  console.log("Signing transaction");
  tx.sign([sender.privateKey, ...extraSigners]);

  const sentTx = await tx.safeSend();

  return sentTx;
}
