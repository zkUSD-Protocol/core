import { Empty, Proof, Transaction, ZkappPublicInput } from 'o1js';
import {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from '../../mina/transaction-executor.js';
import {
  FailedBeforeSending,
  RejectedOnInclusion,
  RejectedOnReceive,
} from '../../mina/transaction-status.js';
import { TrackedPromise } from '../../utils/tracked-promise.js';
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  ProvingJobType,
  ProvingJobPayload,
  AnyProvingJob,
} from './shared-types';
import { JobStore } from './job-store.js';
import { ExternalProcess } from './external-process.js';
import { Mutex } from '../../utils/mutex.js';

export { ExternalTransactionExecutor };

type TxLifecycleTracker = {
  proving: {
    resolvers: ((
      proofs: (Proof<ZkappPublicInput, Empty> | undefined)[]
    ) => void)[];
    rejectors: ((st: { status: FailedBeforeSending }) => void)[];
  };
  sending: {
    resolvers: (({
      hash,
      status,
    }: {
      hash: string;
      status: 'Pending';
    }) => void)[];
    rejectors: ((st: {
      status: RejectedOnReceive | FailedBeforeSending;
    }) => void)[];
  };
};

const mkEmptyTxLifecycleTracker: () => TxLifecycleTracker = () => {
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
};

interface WorkerManager {
  scheduleTxExecution(args: {
    signedTx: Transaction<any, true>;
    lifecycleTracker: TxLifecycleTracker;
  }): Promise<void>;
}

// TODO add retry logic
class ExternalTransactionExecutor implements ITransactionExecutor {
  workerManager: WorkerManager;

  async executeTransaction(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig,
    _options?: unknown
  ): Promise<TransactionLifecycle> {
    // sign locally and await deps at the same time.
    const [{ signedTx, nonceLock }] = await Promise.all([
      tx.mkSigningPromise(config.startingFee, tx.tx),
      tx.depsAwaitingPromise.catch(),
    ]);

    const lifecycleTracker = mkEmptyTxLifecycleTracker();

    const mkRet = <T>(st: T) => {
      return { isLocal: false as false, ...st };
    };
    const mkErr = (err: {
      status: RejectedOnReceive | RejectedOnInclusion | FailedBeforeSending;
    }) => {
      return { isLocal: false as false, errors: err.status.errors };
    };

    // execution will  happen externally in one go
    // phases will be updated by status callback

    // build proving tracking promise
    const provingPromise = new TrackedPromise<ProvenTransaction>(() => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Proving ...`);
      }

      return new Promise<(Proof<ZkappPublicInput, Empty> | undefined)[]>(
        (resolve, reject) => {
          lifecycleTracker.proving.resolvers.push(resolve);
          lifecycleTracker.proving.rejectors.push(reject);
        }
      )
        .then((proofs) => {
          return mkRet({ proofs });
        })
        .catch(({ status }) => {
          tx.setStatus(status);
          return mkErr(status);
        });
    }, `Proving tx: ${tx.getId()} promise.`);

    // build sending tracking promise
    const sendingPromise = new TrackedPromise<SentTransaction>(() => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Sending ...`);
      }

      return new Promise<{ hash: string; status: 'Pending' }>(
        (resolve, reject) => {
          lifecycleTracker.sending.resolvers.push(resolve);
          lifecycleTracker.sending.rejectors.push(reject);
        }
      )
        .then(async ({ hash, status }) => {
          await nonceLock.unlock();
          tx.setStatus(status);
          return mkRet({ hash });
        })
        .catch(async ({ status }) => {
          await nonceLock.unlock();
          tx.setStatus(status);
          return mkErr(status);
        });
    }, `Sending tx: ${tx.getId()} promise.`);

    // build waiting tracking promise
    const waitingPromise = new TrackedPromise<AwaitedTransaction>(async () => {
      if (config?.printTx) {
        console.log(`${tx.getId()} - Awaiting inclusion ...`);
      }
      // TODO
      return mkRet({ status: 'Included' as 'Included' });
    }, `Waiting tx: ${tx.getId()} promise.`);

    this.workerManager.scheduleTxExecution({
      signedTx,
      lifecycleTracker,
    });

    return Promise.resolve({
      provingPromise,
      sendingPromise,
      waitingPromise,
    });
  }
}

export class ExternalProcessManager implements WorkerManager {
  private mutex = new Mutex();
  private isShuttingDown = false; // to stop auto-restarting of workers
  private app = express();
  private server: any; // store the HTTP server instance
  private workers: ExternalProcess[] = [];
  private jobPromises: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  constructor(
    private jobStore: JobStore,
    private port: number = 4646
  ) {
    this.app.use(express.json());
    this.setupRoutes();
  }

  /**
   * Initialize EPM by starting the HTTP server on the given port.
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
   * A helper that spawns a single worker and sets up monitoring to restart it on crash.
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

  /**
   * Shutdown method that ensures all workers are properly stopped.
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down ExternalProcessManager...');

    this.isShuttingDown = true; // Prevent worker restarts

    // Kill all spawned workers
    this.workers.forEach((worker) => {
      console.log(`Stopping worker process ${worker.proverId}`);
      worker.stop();
    });

    // Ensure workers array is cleared
    this.workers = [];

    // Close the Express server
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }

    console.log('ExternalProcessManager shut down.');
  }

  /**
   * Spawn a number of worker processes (each running the external-process script).
   */
  public spawnWorkers(workers: ExternalProcess[]): void {
    for (let i = 0; i < workers.length; i++) {
      this.spawnOneWorker(i, workers[i]);
    }
  }

  /**
   * Async method for proving a job from within the TS API.
   * - assignmentTimeoutMs: default 60s, or override as needed
   */
  public async proveJob<T extends ProvingJobType>(
    type: T,
    payload: ProvingJobPayload[T],
    assignmentTimeoutMs = 60_000
  ): Promise<unknown> {
    const jobId = uuidv4();
    const job: AnyProvingJob = {
      id: jobId,
      type,
      payload,
      assignmentTimeoutMs,
    };

    // Insert into the job store
    await this.mutex.runExclusive(async () => {
      await this.jobStore.addJob(job);
    });

    return new Promise((resolve, reject) => {
      this.jobPromises.set(jobId, { resolve, reject });
    });
  }

  /**
   * Define the HTTP endpoints that external provers will call.
   */
  private setupRoutes(): void {
    // 1) Next available job
    this.app.get('/jobs/next', async (req: Request, res: Response) => {
      try {
        let job;
        await this.mutex.runExclusive(async () => {
          job = await this.jobStore.getNextAvailableJob();
          if (!job) {
            return res.status(204).send();
          }

          // Immediately mark this job as assigned
          await this.jobStore.markJobAsAssigned(job.id);
        });
        if (!job) return res.status(204).send();
        return res.json(job);
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to get next job' });
      }
    });

    // 2) Submit result
    this.app.post('/jobs/:id/result', async (req: Request, res: Response) => {
      const jobId = req.params.id;
      const { result } = req.body;

      try {
        await this.mutex.runExclusive(async () => {
          await this.jobStore.markJobAsCompleted(jobId, result);
        });

        // If there's a local promise for this job, resolve it
        const jobPromise = this.jobPromises.get(jobId);
        if (jobPromise) {
          // Even if multiple workers post, we only resolve once.
          jobPromise.resolve(result);
          this.jobPromises.delete(jobId);
        }

        return res.json({ status: 'ok' });
      } catch (err) {
        console.error(err);
        return res
          .status(500)
          .json({ error: 'Failed to mark job as completed' });
      }
    });
  }
}
