import express, { Request, Response } from 'express';
import { Mutex } from '../../utils/mutex';
import {
  ITransactionProver,
  TxProvingInput,
  TxProvingOutput,
} from '../itransactionprover';
import { JobStore } from '../job-store';
import { InMemoryJobStore } from '../in-memory-job-store';

export type TransactionExecutionJob = {
  id: string;
  typ: string;
  assignmentTimeoutMs?: number;
  payload: TxProvingInput;
};

type TxProvingTracker = {
  proving: {
    resolver: (arg: TxProvingOutput) => void;
    rejector: (error: unknown) => void;
  };
};

/**
 * Represents an abstract external prover “worker”.
 * Instead of directly spawning a Node script, any implementation
 * can define how to start, stop, and monitor the worker lifecycle.
 */
export interface ChildProcessWorker {
  /**
   * Identifier for this process instance.
   */
  get workerId(): string;

  /**
   * Spawns or starts the worker process/service with the given serverUrl.
   * Optionally takes a workerIndex for logging or identification.
   */
  spawn(serverUrl: string, workerIndex?: number): void;

  /**
   * Registers a callback to be invoked whenever the worker exits (normally or abnormally).
   * @param callback - A function called with `(exitCode, signal)` when the process/service exits.
   */
  onExit(
    callback: (exitCode: number | null, signal: string | null) => void
  ): void;

  /**
   * Stops the worker, sending a graceful termination signal if supported.
   */
  stop(): void;
}

/**
 * Provides proving service by starting http server that provides
 * proving jobs to external http worker clients.
 * You may provide clients to be spawn as child process workers.
 */
export class HttpServerProver implements ITransactionProver {
  private mutex = new Mutex(); // no concurrent job-store access
  private isShuttingDown = false; // when shutting down we dont restart workers
  private app = express();

  private server: any; // store the HTTP server instance
  private jobTrackers: Map<string, TxProvingTracker> = new Map();

  // after 8 minutes after scheduling.
  private static readonly _jobTimeout: number = 8 * 60 * 1000; // 8 minutes

  /**
   * @param jobStore - An object responsible for storing and retrieving job data.
   * @param port - The HTTP port the manager's server will listen on.
   */
  public constructor(
    private jobStore: JobStore<TransactionExecutionJob> = new InMemoryJobStore(
      HttpServerProver._jobTimeout
    ),
    private port: number = 4646,
    private childWorkers: ChildProcessWorker[] = []
  ) {
    this.app.use(express.json({ limit: '50mb' })); // Adjust the limit as needed
    this.setupRoutes();
  }

  public async start(): Promise<void> {
    await this.init();
    this.spawnWorkers(this.childWorkers);
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
  ): Promise<TxProvingOutput> {
    const txId = input.txId;

    let resolver: (arg: TxProvingOutput) => void;
    let rejector: (err: unknown) => void;

    const ret = new Promise<TxProvingOutput>((res, rej) => {
      resolver = res;
      rejector = rej;
    });

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
        this.jobTrackers.set(txId, { proving: { resolver, rejector } });
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
    console.log('Shutting down ChildProcessWorkerManager...');
    this.isShuttingDown = true; // Prevent worker restarts

    // Stop worker processes
    this.childWorkers.forEach((worker) => {
      console.log(`Stopping worker process ${worker.workerId}`);
      worker.stop();
    });
    this.childWorkers = [];

    // Close Express server
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }
    console.log('ChildProcessWorkerManager shut down.');
  }

  /**
   * Spawns an array of external processes and tracks them.
   *
   * @param workers - An array of ChildProcessWorker instances.
   */
  public spawnWorkers(workers: ChildProcessWorker[]): void {
    if (this.childWorkers.length !== 0) {
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
   * @param worker - The ChildProcessWorker instance
   */
  private spawnOneWorker(index: number, worker: ChildProcessWorker): void {
    const epmUrl = `http://localhost:${this.port}`;
    worker.spawn(epmUrl, index);

    this.childWorkers[index] = worker;

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
      let provingResult: TxProvingOutput = req.body;

      let tracker;
      try {
        tracker = this.jobTrackers.get(jobId);
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
        tracker.proving.resolver(provingResult);
        return res.json({ status: 'ok' });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to handle proving result.' });
        if (tracker) {
          tracker.proving.rejector(err);
        }
        throw err;
      }
    });
  }
}
