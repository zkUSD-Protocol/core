import express, { Request, Response } from 'express';
import { Mutex } from '../../utils/mutex.js';
import { JobStore } from './job-store.js';
import { ExternalProcess } from './external-process.js';
import {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionArgs,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from '../../mina/transaction-executor.js';
import {
  FailedBeforeSending,
  RejectedOnInclusion,
  RejectedOnReceive,
  TransactionStatus,
} from '../../mina/transaction-status.js';
import { TrackedPromise } from '../../utils/tracked-promise.js';
import { testnetMinaSigner } from '../signing/mina-signer.js';
import { ZkappCommand } from 'mina-signer/dist/node/mina-signer/src/types.js';
import { Signed } from 'o1js/dist/node/mina-signer/src/types.js';
import { ProvingResult, SendingResult } from './shared-types.js';
import { InMemoryJobStore } from './in-memory-job-store.js';
import { NodeScriptExecutor } from './node-script-tx-executor.js';
import { serializeTransaction } from './transaction-serialization.js';
import { blockchain } from 'zkcloudworker';
import { ITransactionStatusScanner, TransactionStatusScanner } from '../../mina/transaction-status-scanner.js';
import { IMinaNetworkInterface } from '../../mina/mina-network-interface.js';

/* ------------------------------------------------------------------------*/
/*                            TxLifecycleTracker                           */
/* ------------------------------------------------------------------------*/

/**
 * Collection of resolvers/rejectors to handle the asynchronous lifecycles of a
 * transaction being proved, then sent, etc.
 */
type TxLifecycleTracker = {
  proving: {
    resolvers: ((proofs: string[]) => void)[];
    rejectors: ((error: { status: FailedBeforeSending }) => void)[];
  };
  sending: {
    resolvers: ((result: { hash: string; status: 'Pending' }) => void)[];
    rejectors: ((error: {
      status: RejectedOnReceive | FailedBeforeSending;
    }) => void)[];
  };
};

/**
 * Creates a fresh TxLifecycleTracker with empty resolvers and rejectors.
 */
function makeEmptyTxLifecycleTracker(): TxLifecycleTracker {
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
}

// so that we can easily mock things
interface TxExecutorInternal {
  scheduleTxExecution(args: {
    payload: TxExternalExecutionPayload;
    lifecycleTracker: TxLifecycleTracker;
  }): Promise<void>;
}

/* ----------------------------------------------------------------------------*/
/*                        ExternalTransactionExecutor                          */
/* ----------------------------------------------------------------------------*/

/**
 * An implementation of ITransactionExecutor that delegates transaction proving
 * and sending to an external manager via some scheduling mechanism.
 */
export class ExternalTransactionExecutor implements ITransactionExecutor {
  private constructor(
    private workerManager: TxExecutorInternal,
    private _inclusionScanner: ITransactionStatusScanner
  ) {}

  public static initializer(
    args:
      | { executor: TxExecutorInternal }
      | { workers: NodeScriptExecutor[] | number },
    stop?: Promise<void>
  ) {
    return (mina: IMinaNetworkInterface) => {
      return ExternalTransactionExecutor.start(mina, args,stop);
    }
  }

  //start
  public static async start(
    mina: IMinaNetworkInterface,
    args:
      | { executor: TxExecutorInternal }
      | { workers: NodeScriptExecutor[] | number },
    stop?: Promise<void>
  ): Promise<ExternalTransactionExecutor> {
    if (mina.network.chainId === 'local') {
      throw new Error(
        'ExternalTransactionExecutor cannot be used with a local chain.'
      );
    }
    let e: TxExecutorInternal;
    // if workers then create new TransactionWorkerManager
    if ('workers' in args) {
      e = await TransactionWorkerManager.start(mina.network.chainId, args.workers);
    } else {
      e = args.executor;
    }
    const scanner = new TransactionStatusScanner(mina);
    const ret = new ExternalTransactionExecutor(e, scanner);
    await ret._inclusionScanner.startScanning();
    if (stop) {
      setTimeout(async () => {
        await stop;
        await ret.stop();
      });
    }
    return ret;
  }

  // stop
  public async stop(): Promise<void> {
    await this._inclusionScanner.stopScanning();
    //stop the worker manager
    if (this.workerManager instanceof TransactionWorkerManager) {
      await this.workerManager.shutdown();
    }
  }

  /**
   * Returns the global Mina-signer instance.
   */
  public get signer() {
    return testnetMinaSigner;
  }

  private async awaitTx(
    hash: string,
    timeoutMs: number
  ): Promise<'Included' | RejectedOnInclusion> {
    return await this._inclusionScanner.awaitTransactionStatus(hash, timeoutMs);
  }

  /**
   * Schedules a transaction for external proving and sending. Returns a
   * TransactionLifecycle containing promises for each stage:
   *   1) Proving (provingPromise)
   *   2) Sending (sendingPromise)
   *   3) Waiting for chain inclusion (waitingPromise)
   *
   * @param tx - A prepared transaction including the transaction body and keys.
   * @param config - Execution config including fees, logging flags, etc.
   * @returns A TransactionLifecycle with promises for each phase.
   */
  async scheduleTx(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig,
    _options?: unknown
  ): Promise<TransactionLifecycle> {
    if (!tx.args) {
      throw new Error('Transaction args are required when using the external executor');
    }

    // Acquire a nonce lock to ensure we have a consistent nonce for this tx
    const nonceLock = await tx.nonceLock(tx.keys.sender.publicKey);

    try {
      // We sign and wait for any dependencies in parallel
      const [{ signedTx }] = await Promise.all([
        this.signer({
          fee: config.startingFee,
          nonce: nonceLock.nonce,
          tx: tx.tx,
          keys: tx.keys,
        }),
        tx.depsAwaitingPromise,
      ]);

      // Create a fresh lifecycle tracker
      const lifecycleTracker = makeEmptyTxLifecycleTracker();

      // Helper: wrap success results in a consistent shape
      const wrapNoErrors = <T>(value: T & { status?: TransactionStatus }) => ({
        isLocal: false as const,
        ...value,
      });

      // Helper: wrap error results in a consistent shape
      const wrapError = (err: {
        status: RejectedOnReceive | RejectedOnInclusion | FailedBeforeSending
      }) => ({
        isLocal: false as const,
        errors: err.status.errors,
      });

      // ---- Proving Promise ----
      const provingPromise = new TrackedPromise<ProvenTransaction>(() => {
        return new Promise<string[]>((resolve, reject) => {
          lifecycleTracker.proving.resolvers.push(resolve);
          lifecycleTracker.proving.rejectors.push(reject);
        })
          .then((proofs) => {
            if (config?.printTx) {
              console.log(`${tx.getId()} - Proved.`);
            }
            return wrapNoErrors({ proofs });
          })
          .catch(({ status }) => {
            tx.setStatus(status);
            if (config?.printTx) {
              console.log(`${tx.getId()} - Proving failed with status ${JSON.stringify(status, null, 2)}.`);
            }
            return wrapError({ status });
          });
      }, `Proving tx: ${tx.getId()}`);

      // ---- Sending Promise ----
      const sendingPromise = new TrackedPromise<SentTransaction>(() => {
        return new Promise<{ hash: string; status: 'Pending' }>(
          (resolve, reject) => {
            lifecycleTracker.sending.resolvers.push(resolve);
            lifecycleTracker.sending.rejectors.push(reject);
          }
        )
          .then(async ({ hash, status }) => {
            await nonceLock.unlock();
            tx.setStatus(status);
            if (config?.printTx) {
              console.log(`${tx.getId()} - Sent. Transaction pending inclusion.`);
            }
            return wrapNoErrors({ hash });
          })
          .catch(async ({ status }) => {
            await nonceLock.unlock();
            tx.setStatus(status);
            if (config?.printTx) {
              console.log(`${tx.getId()} - Failed on sent. Status: ${JSON.stringify(status, null, 2)}.`);
            }
            return wrapError({ status });
          });
      }, `Sending tx: ${tx.getId()}`);

      // ---- Waiting Promise (for chain inclusion) ----
      const waitingPromise = new TrackedPromise<AwaitedTransaction>(
        async () => {
          if (config?.printTx) {
            console.log(`${tx.getId()} - Awaiting inclusion ...`);
          }
          const sentTx = await sendingPromise;
          if (sentTx.isLocal) {
            throw new Error('isLocal should be false in external executor');
          }
          if ('hash' in sentTx) {
            // success -> await
            try {
              const inclusionStatus = await this.awaitTx(sentTx.hash, config.awaitingTimeoutMs);
              if (inclusionStatus === 'Included') {
                tx.setStatus('Included');
                return wrapNoErrors({ status: 'Included' });
              } else {
                tx.setStatus(inclusionStatus);
                return wrapNoErrors({ status: inclusionStatus });
              }
            } catch (error) {
              tx.setStatus("StuckInMempool");
              return wrapNoErrors({ status: "StuckInMempool" });
            }
          } else if ('errors' in sentTx) {
            // status should already be set
            return wrapNoErrors({ status: { kind: 'RejectedOnReceive', errors: sentTx.errors } });
          } else {
            throw new Error('unknown sentTx shape');
          }
        },
        `Waiting tx: ${tx.getId()}`
      );

      // Hand off to the external worker manager
      await this.workerManager.scheduleTxExecution({
        lifecycleTracker,
        payload: {
          txId: tx.getId(),
          transaction: {
            serializedTx: serializeTransaction(tx.tx),
            signedData: signedTx,
          },
          ...tx.args,
        },

      });

      // Return a structure that allows the caller to await each stage
      return {
        provingPromise,
        sendingPromise,
        waitingPromise,
      };
    } catch (error) {
      await nonceLock.unlock();
      throw error;
    }
  }
}
/* ------------------------------------------------------------------------*/
/*                       TransactionWorkerManager                          */
/* ------------------------------------------------------------------------*/

export type TransactionExecutionJob = {
  id: string;
  typ: string;
  assignmentTimeoutMs?: number;
  payload: TxExternalExecutionPayload;
};

export type TxExternalExecutionPayload = {
  txId: string;
  transaction: {
    serializedTx: string;
    signedData: Signed<ZkappCommand>;
  }
} & TransactionArgs

/**
 * Manages external worker processes (provers/senders). Responsible for:
 *   1. Hosting an HTTP server that workers use to fetch jobs and post results.
 *   2. Tracking job states via `jobStore`.
 *   3. Exposing endpoints for prove/sent callbacks.
 */
export class TransactionWorkerManager implements TxExecutorInternal {
  private mutex = new Mutex(); // no concurrent job-store access
  private isShuttingDown = false; // when shutting down we dont restart workers
  private app = express();
  private server: any; // store the HTTP server instance
  private workers: ExternalProcess[] = [];
  private jobTrackers: Map<string, TxLifecycleTracker> = new Map();

  // after 8 minutes after scheduling.
  private static readonly _jobTimeout: number = 8 * 60 * 1000; // 8 minutes

  /**
   * @param jobStore - An object responsible for storing and retrieving job data.
   * @param port - The HTTP port the manager's server will listen on.
   */
  private constructor(
    private jobStore: JobStore<TransactionExecutionJob> = new InMemoryJobStore(
      TransactionWorkerManager._jobTimeout
    ),
    private port: number = 4646
  ) {
    this.app.use(express.json());
    this.setupRoutes();
  }

  public static async start(
    chain: blockchain,
    workers: ExternalProcess[] | number,
    jobStore?: JobStore<TransactionExecutionJob>,
    port?: number
  ): Promise<TransactionWorkerManager> {
    const manager = new TransactionWorkerManager(jobStore, port);
    await manager.init();
    // if (!workers) {
    //   throw new Error('No workers provided');
    // }
    if (typeof workers === 'number') {
      manager.spawnWorkers(
        new Array(workers).fill(0).map((_, i) => new NodeScriptExecutor(chain))
      );
    } else {
      manager.spawnWorkers(workers);
    }
    return manager;
  }

  /**
   * Schedules a new transaction execution job.
   * External workers will pick up the work and update the job state via HTTP endpoints.
   *
   * @param args - The transaction execution details
   * @param args.payload - What is required by a worker.
   * @param args.lifecycleTracker - Tracker for transaction state updates
   *
   * @throws If job scheduling fails due to a database error or mutex contention.
   */
  public async scheduleTxExecution(args: {
    payload: TxExternalExecutionPayload;
    signedTx: Signed<ZkappCommand>;
    lifecycleTracker: TxLifecycleTracker;
  }): Promise<void> {
    const { payload, lifecycleTracker } = args;
    const txId = payload.txId;

    try {
      // Lock access to prevent concurrent job queue modifications
      await this.mutex.runExclusive(async () => {
        // Store the transaction job in the job store
        await this.jobStore.addJob({
          id: txId,
          typ: 'transaction',
          payload,
        });

        // Register lifecycle tracking for this job
        this.jobTrackers.set(txId, lifecycleTracker);
      });

      console.debug(`Scheduled transaction job ${txId} successfully.`);
    } catch (err) {
      console.error(`Failed to schedule tx execution for job ${txId}:`, err);
      throw err; // Propagate the error to ensure proper handling upstream
    }
  }

  /**
   * Starts the HTTP server for the EPM. Resolves when the server is listening.
   */
  public async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          console.log(`EPM server listening on port ${this.port}`);
          resolve();
        })
        .on('error', reject);
    });
  }

  /**
   * Shuts down the EPM by stopping all workers and closing the HTTP server.
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down ExternalProcessManager...');
    this.isShuttingDown = true; // Prevent worker restarts

    // Stop worker processes
    this.workers.forEach((worker) => {
      console.log(`Stopping worker process ${worker.proverId}`);
      worker.stop();
    });
    this.workers = [];

    // Close Express server
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }
    console.log('ExternalProcessManager shut down.');
  }

  /**
   * Spawns an array of external processes and tracks them.
   *
   * @param workers - An array of ExternalProcess instances.
   */
  public spawnWorkers(workers: ExternalProcess[]): void {
    if (this.workers.length !== 0) {
      throw new Error(
        'Workers already spawned. Shutdown before spawning again.'
      );
    }
    workers.forEach((worker, index) => {
      this.spawnOneWorker(index, worker);
    });
  }

  /**
   * Spawns a single worker, listening for crashes, and optionally restarts if not shutting down.
   *
   * @param index - Worker index/ID
   * @param worker - The ExternalProcess instance
   */
  private spawnOneWorker(index: number, worker: ExternalProcess): void {
    const epmUrl = `http://localhost:${this.port}`;
    worker.spawn(epmUrl, index);

    this.workers[index] = worker;

    worker.onExit((code, signal) => {
      console.error(
        `Worker #${index} exited with code=${code} signal=${signal}`
      );
      if (!this.isShuttingDown) {
        console.log(`Restarting worker #${index}...`);
        worker.spawn(epmUrl, index);
      }
    });
  }

  /* ----------------------------------------------------------------------------*/
  /*                            HTTP ROUTE HANDLERS                              */
  /* ----------------------------------------------------------------------------*/

  // TODO use zod schemas to ensure safe transport
  /**
   * Sets up the Express routes for:
   *   1. GET `/jobs/next`  - Retrieve the next available job
   *   2. POST `/jobs/:id/proved` - Receive proving result
   *   3. POST `/jobs/:id/sent`   - Receive sending result
   */
  private setupRoutes(): void {
    /**
     * 1) GET /jobs/next
     *    - Returns 204 if no job available
     *    - Otherwise returns the next job in JSON
     */
    this.app.get('/jobs/next', async (_req: Request, res: Response) => {
      try {
        let job: TransactionExecutionJob | undefined;
        await this.mutex.runExclusive(async () => {
          job = await this.jobStore.getNextAvailableJob();
          if (job) {
            // Immediately mark it as assigned so no other worker picks it up
            await this.jobStore.markJobAsAssigned(job.id);
          }
        });

        if (!job) {
          return res.status(204).send();
        }

        return res.json(job);
      } catch (err) {
        console.error(err);
        // Return 500 and re-throw so that the process can be handled higher up
        res.status(500).json({ error: 'Failed to get next job' });
        throw err;
      }
    });

    /**
     * 2) POST /jobs/:id/proved
     *    - External worker notifies that a job has been proved (or has failed).
     */
    this.app.post('/jobs/:id/proved', async (req: Request, res: Response) => {
      const jobId = req.params.id;
      let provingResult: ProvingResult = req.body;

      try {
        const tracker = this.jobTrackers.get(jobId);
        if (!tracker) {
          throw new Error(
            `Invalid transaction job state: no lifecycle tracker found for jobId=${jobId}`
          );
        }

        // If success, resolve all 'proving' promises. Otherwise, reject them.
        if (provingResult.success) {
          const proofs = provingResult.proofs;
          tracker.proving.resolvers.forEach((resolve) => resolve(proofs));
        } else {
          await this.mutex.runExclusive(async () => {
            await this.jobStore.markJobAsCompleted(jobId, provingResult);
          });

          const failure = provingResult as { status: FailedBeforeSending };
          tracker.proving.rejectors.forEach((reject) =>
            reject({ status: failure.status })
          );
          this.jobTrackers.delete(jobId);
        }
        return res.json({ status: 'ok' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to handle proving result.' });
        throw err;
      }
    });

    /**
     * 3) POST /jobs/:id/sent
     *    - External worker notifies that a job has been sent (or has failed).
     */
    this.app.post('/jobs/:id/sent', async (req: Request, res: Response) => {
      const jobId = req.params.id;
      let sendingResult: SendingResult;

      try {
        // NOTE: If you want more robust validation, implement similarly to parseProvingResult.
        sendingResult = req.body as SendingResult;
      } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Could not parse sending result.' });
        throw err;
      }

      try {
        const tracker = this.jobTrackers.get(jobId);
        if (!tracker) {
          throw new Error(
            `Invalid transaction job state: no lifecycle tracker found for jobId=${jobId}`
          );
        }

        if (sendingResult.success) {
          const success = sendingResult as { hash: string; status: 'Pending' };
          console.log(`Transaction ${jobId} sent successfully. Hash: ${success.hash}`);
          tracker.sending.resolvers.forEach((resolve) =>
            resolve({ hash: success.hash, status: 'Pending' })
          );
        } else {
          const failure = sendingResult as {
            status: RejectedOnReceive | FailedBeforeSending;
          };
          tracker.sending.rejectors.forEach((reject) =>
            reject({ status: failure.status })
          );
        }

        await this.mutex.runExclusive(async () => {
          await this.jobStore.markJobAsCompleted(jobId, sendingResult);
          this.jobTrackers.delete(jobId);
        });

        return res.json({ status: 'ok' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: `Server error handling send result.` });
        throw err;
      }
    });
  }
}
