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
import { ProvingResult } from './shared-types.js';
import { InMemoryJobStore } from './in-memory-job-store.js';
import { NodeScriptProver } from './node-script-tx-executor.js';
import {
  deserializeTransaction,
  serializeTransaction,
} from './transaction-serialization.js';
import { blockchain } from 'zkcloudworker';
import {
  ITransactionStatusScanner,
  TransactionStatusScanner,
} from '../../mina/transaction-status-scanner.js';
import { IMinaNetworkInterface } from '../../mina/mina-network-interface.js';

// so that we can easily mock things
interface ITransactionProver {
  proveTransaction(
    input: TxProvingInput
  ): Promise<{ serializedProvenTransaction: string }>;
}

/* ----------------------------------------------------------------------------*/
/*                        ExternalTransactionExecutor                          */
/* ----------------------------------------------------------------------------*/

/**
 * An implementation of ITransactionExecutor that delegates transaction proving
 * and sending to an external manager via some scheduling mechanism.
 */
export class ExternalProvingTransactionExecutor
  implements ITransactionExecutor
{
  private constructor(
    private readonly prover: ITransactionProver,
    private readonly inclusionScanner: ITransactionStatusScanner
  ) {}

  /**
   * Provides an initializer function that can be passed
   * as a setup step to Mina network instances.
   */
  public static initializer(
    args:
      | { prover: ITransactionProver }
      | { workers: NodeScriptProver[] | number },
    stop?: Promise<void>
  ) {
    return (mina: IMinaNetworkInterface) =>
      ExternalProvingTransactionExecutor.start(mina, args, stop);
  }

  /**
   * Create and start an ExternalTransactionExecutor.
   */
  public static async start(
    mina: IMinaNetworkInterface,
    args:
      | { prover: ITransactionProver }
      | { workers: NodeScriptProver[] | number },
    stop?: Promise<void>
  ): Promise<ExternalProvingTransactionExecutor> {
    if (mina.network.chainId === 'local') {
      throw new Error(
        'ExternalTransactionExecutor cannot be used with a local chain.'
      );
    }

    // Determine which worker manager/executor to use
    const prover =
      'workers' in args
        ? await TransactionWorkerManager.start(
            mina.network.chainId,
            args.workers
          )
        : args.prover;

    const scanner = new TransactionStatusScanner(mina);
    const executor = new ExternalProvingTransactionExecutor(
      prover,
      scanner
    );

    await executor.inclusionScanner.startScanning();

    // If a stop signal is provided, stop this executor when resolved
    if (stop) {
      stop
        .then(() => executor.stop())
        .catch((err) => {
          console.error(
            'Error while stopping ExternalTransactionExecutor:',
            err
          );
        });
    }

    return executor;
  }

  /**
   * Gracefully stop scanning and shut down the worker manager (if any).
   */
  public async stop(): Promise<void> {
    await this.inclusionScanner.stopScanning();
    if (this.prover instanceof TransactionWorkerManager) {
      await this.prover.shutdown();
    }
  }

  /**
   * Returns the global Mina-signer instance (e.g., for offline signing).
   */
  public get signer() {
    return testnetMinaSigner;
  }

  /**
   * Await the final chain status of a transaction by its hash.
   */
  private async awaitTx(
    hash: string,
    timeoutMs: number
  ): Promise<'Included' | RejectedOnInclusion> {
    return this.inclusionScanner.awaitTransactionStatus(hash, timeoutMs);
  }

  public async executeTransaction(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig
  ): Promise<TransactionLifecycle> {
    if (!tx.args) {
      throw new Error(
        'Transaction args are required when using the external executor'
      );
    }

    // Helpers for standardizing success/error shapes
    const wrapNoErrors = <T>(value: T & { status?: TransactionStatus }) => ({
      isLocal: false as const,
      ...value,
    });

    const wrapError = (err: {
      status: RejectedOnReceive | RejectedOnInclusion | FailedBeforeSending;
    }) => ({
      isLocal: false as const,
      errors: err.status.errors,
    });

    // Acquire a nonce lock to ensure a consistent nonce for this tx
    const nonceLock = await tx.nonceLock(tx.keys.sender.publicKey);

    try {
      // Sign and await dependencies in parallel
      const [{ signedTx }] = await Promise.all([
        this.signer({
          fee: config.startingFee,
          nonce: nonceLock.nonce,
          tx: tx.tx,
          keys: tx.keys,
        }),
        tx.depsAwaitingPromise,
      ]);

      const input = {
        txId: tx.getId(),
        transaction: {
          serializedTx: serializeTransaction(tx.tx),
          signedData: signedTx,
        },
        ...tx.args,
        }

      // ---- Proving Promise ----
      const provingPromise = new TrackedPromise<ProvenTransaction>(
        async () =>
          await this.prover.proveTransaction(input)
            .then(({ serializedProvenTransaction}) => {
              if (config?.printTx) {
                console.log(`${tx.getId()} - Proved.`);
              }
              return wrapNoErrors({ serializedProvenTransaction });
            })
            .catch(async ({ status }) => {
              tx.setStatus(status);
              if (config?.printTx) {
                console.log(
                  `${tx.getId()} - Proving failed: ${JSON.stringify(status)}`
                );
              }
              await nonceLock.unlock();
              return wrapError({ status });
            }),
        `Proving tx: ${tx.getId()}`
      );

      // ---- Sending Promise ----
      const sendingPromise = new TrackedPromise<SentTransaction>(async () => {
        try {
          const proveResult = await provingPromise;

          if (proveResult.isLocal) {
            throw new Error('isLocal should be false in external executor');
          }

          if ('serializedProvenTransaction' in proveResult) {
            const readyToSendTx = deserializeTransaction(
              proveResult.serializedProvenTransaction,
              tx.tx,
              signedTx.data
            );

            // Send the transaction
            const sendResult = await readyToSendTx.safeSend();
            // unlock the nonce before returning
            await nonceLock.unlock();

            if (sendResult.status === 'rejected') {
              const status: RejectedOnReceive = {
                kind: 'RejectedOnReceive',
                errors: sendResult.errors,
              };
              if (config?.printTx) {
                console.log(
                  `${tx.getId()} - Send failed: ${JSON.stringify(status)}`
                );
              }
              tx.setStatus(status);
              return wrapError({ status });
            } else {
              if (config?.printTx) {
                console.log(
                  `${tx.getId()} - Sent successfully. The tx is pending inclusion.`
                );
              }
              tx.setStatus('Pending');
              return wrapNoErrors({ hash: sendResult.hash });
            }
          } else {
            // Proving failed
            const status: FailedBeforeSending = {
              kind: 'FailedBeforeSending',
              errors: ['Proving failed', ...proveResult.errors],
            };
            return wrapError({ status });
          }
        } catch (error) {
          await nonceLock.unlock();
          const stringError = error instanceof Error ? error.message : '';
          const status: FailedBeforeSending = {
            kind: 'FailedBeforeSending',
            errors: ['Exceptional failure', stringError],
          };
          tx.setStatus(status);
          throw error;
        }
      }, `Sending tx: ${tx.getId()}`);

      // ---- Waiting Promise (chain inclusion) ----
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
            // We have a valid transaction hash; await chain inclusion
            try {
              const inclusionStatus = await this.awaitTx(
                sentTx.hash,
                config.awaitingTimeoutMs
              );

              if (inclusionStatus === 'Included') {
                tx.setStatus('Included');
                return wrapNoErrors({ status: 'Included' });
              } else {
                tx.setStatus(inclusionStatus);
                return wrapNoErrors({ status: inclusionStatus });
              }
            } catch {
              // If we fail to get a final status, assume it's stuck
              tx.setStatus('StuckInMempool');
              return wrapNoErrors({ status: 'StuckInMempool' });
            }
          } else if ('errors' in sentTx) {
            // Rejected on sending
            return wrapNoErrors({
              status: { kind: 'RejectedOnReceive', errors: sentTx.errors },
            });
          } else {
            throw new Error('Unknown transaction shape after sending.');
          }
        },
        `Waiting tx: ${tx.getId()}`
      );

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
  payload: TxProvingInput;
};

export type TxProvingInput = {
  txId: string;
  transaction: {
    serializedTx: string;
    signedData: Signed<ZkappCommand>;
  };
} & TransactionArgs;


/**
 * Collection of resolvers/rejectors to handle the asynchronous lifecycles of a
 * transaction being proved, then sent, etc.
 */
type TxProvingTracker = {
  proving: {
    resolver: (arg:{ serializedProvenTransaction: string }) => void;
    rejector: (error: { status: FailedBeforeSending }) => void;
  };
};


/**
 * Manages external worker processes (provers/senders). Responsible for:
 *   1. Hosting an HTTP server that workers use to fetch jobs and post results.
 *   2. Tracking job states via `jobStore`.
 *   3. Exposing endpoints for prove/sent callbacks.
 */
export class TransactionWorkerManager implements ITransactionProver {
  private mutex = new Mutex(); // no concurrent job-store access
  private isShuttingDown = false; // when shutting down we dont restart workers
  private app = express();

  private server: any; // store the HTTP server instance
  private workers: ExternalProcess[] = [];
  private jobTrackers: Map<string, TxProvingTracker> = new Map();

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
    this.app.use(express.json({ limit: '50mb' })); // Adjust the limit as needed
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
        new Array(workers).fill(0).map((_, i) => new NodeScriptProver(chain))
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
  public async proveTransaction(
    input: TxProvingInput
  ): Promise<{ serializedProvenTransaction: string }> {
    const txId = input.txId;

    let resolver: (arg:{ serializedProvenTransaction: string }) => void;
    let rejector: (error: { status: FailedBeforeSending }) => void;

    const ret = new Promise<{ serializedProvenTransaction: string }>((res,rej) => {
      resolver=res;
      rejector=rej;
    })

    try {
      // Lock access to prevent concurrent job queue modifications
      await this.mutex.runExclusive(async () => {
        // Store the transaction job in the job store
        await this.jobStore.addJob({
          id: txId,
          typ: 'transaction',
          payload: input,
        });

        // Register lifecycle tracking for this job
        this.jobTrackers.set(txId, {proving:{resolver,rejector}});
      });

      console.debug(`Scheduled transaction job ${txId} successfully.`);
      return ret;
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
  };
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
          console.warn(
            'Job missing or already completed: No lifecycle tracker found for jobId=',
            jobId
          );
          return res.status(200).json({
            status: 'ok',
            message: 'Job already completed or missing.',
          });
        }
        this.jobTrackers.delete(jobId);

        await this.mutex.runExclusive(async () => {
          await this.jobStore.markJobAsCompleted(jobId, provingResult);
        });
        if (provingResult.success) {
            tracker.proving.resolver({ serializedProvenTransaction: provingResult.serializedTx});
        } else {
          const failure = provingResult as { status: FailedBeforeSending };
          tracker.proving.rejector({status: failure.status})
        }
        return res.json({ status: 'ok' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to handle proving result.' });
        throw err;
      }
    });

  }
}
