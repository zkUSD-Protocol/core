import express, { Request, Response } from 'express';
import { Mutex } from '../../utils/mutex.js';
import {
  ITransactionProver,
  TransactionProvingWorkerStatus,
  TxProvingInput,
  TxProvingOutput,
} from '../itransactionprover.js';
import { JobStore } from '../job-store.js';
import {
  InMemoryJobStore,
  InMemoryJobStoreTimeouts,
} from '../in-memory-job-store.js';
import { Server } from 'http';
import net from 'net';

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

// const DEBUG = !!process.env.DEBUG;

// const debugLog = (msg: string) => {
//   if (DEBUG) {
//     console.debug(msg);
//   }
// };

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
  private isShuttingDown = false; // when shutting down we don't restart workers
  private app = express();
  private server: Server; // store the HTTP server instance
  private jobTrackers: Map<string, TxProvingTracker> = new Map();

  // Default job timeout (8 minutes)
  private static readonly _jobTimeouts: InMemoryJobStoreTimeouts = {
    maxTotalJobTimeSec: 120,
    maxJobInactivitySec: undefined, // disable
  };

  private jobStore: JobStore<TransactionExecutionJob>;
  private port: number;
  private childWorkers: ChildProcessWorker[];

  private connections: Set<net.Socket> = new Set();

  /**
   * @param options - Object containing initialization parameters.
   */
  public constructor({
    jobTimeouts = HttpServerProver._jobTimeouts,
    jobStore = new InMemoryJobStore({ timeouts: jobTimeouts }),
    port = 4646,
    childWorkers = [],
  }: {
    jobTimeouts?: InMemoryJobStoreTimeouts;
    jobStore?: JobStore<TransactionExecutionJob>;
    port?: number;
    childWorkers?: ChildProcessWorker[];
  } = {}) {
    this.jobStore = jobStore;
    this.port = port;
    this.childWorkers = childWorkers;

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
    // const txId = input.txId;

    let jobId = sanitizeForRoute(input.txId);

    // check if job already exists
    if (this.jobTrackers.has(jobId)) {
      jobId = `${jobId}-${Date.now()}`;
    }

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
          id: jobId,
          typ: 'transaction',
          payload: input,
        });

        // Register lifecycle tracking for this job
        this.jobTrackers.set(jobId, { proving: { resolver, rejector } });
      });

      console.debug(`Scheduled transaction job "${jobId}" successfully.`);
      return ret;
    } catch (err) {
      console.error(`Failed to schedule tx execution for job ${jobId}:`, err);
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

      this.server.on('connection', (conn) => {
        this.connections.add(conn);

        // Remove the connection from the set when it closes
        conn.on('close', () => {
          this.connections.delete(conn);
        });
      });
    });
  }

  /**
   * Shuts down the EPM by stopping all workers and closing the HTTP server.
   */
  public async shutdown(forceTimeout?: number): Promise<void> {
    console.log('Shutting down HttpServerProver...');
    this.isShuttingDown = true; // Prevent worker restarts

    // Stop worker processes
    this.childWorkers.forEach((worker) => {
      console.log(`Stopping worker process ${worker.workerId}`);
      worker.stop();
    });
    this.childWorkers = [];

    // Close Express server
    if (this.server) {
      // Start closing the server (stops accepting new connections)
      this.server.close((err) => {
        if (err) {
          console.error('Error closing server:', err);
        } else {
          console.log('Server has been closed gracefully.');
        }
      });

      if (forceTimeout) {
        // After `forceTimeout` ms, forcibly destroy any remaining open connections.
        setTimeout(() => {
          this.connections.forEach((conn) => {
            // This will terminate the socket immediately,
            // even if the request/response was in progress.
            conn.destroy();
          });
          console.log('All remaining connections have been forced closed.');
        }, forceTimeout);
      }
      await new Promise((resolve) => this.server.close(resolve));
    }
    console.log('HttpServerProver shut down.');
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
   *   1. GET `/job/next`  - Retrieve the next available job
   *   2. POST `/job/:id/proved` - Receive proving result
   *   3. POST `/job/:id/sent`   - Receive sending result
   *   4. POST `/worker/:workerid/hearbeat` - Receive worker heartbeat
   */
  private setupRoutes(): void {
    /**
       4) POST /worker/:workerid/hearbeat
        - Worker sends a heartbeat to the server
      */
    this.app.post(
      '/worker/:workerid/heartbeat',
      async (req: Request, res: Response) => {
        const workerId = req.params.workerid;
        const status = req.body.status as TransactionProvingWorkerStatus;
        console.log('received a heartbeat from worker', workerId, status);

        if (status.proving) {
          await this.jobStore.markJobAsBeingProven(status.provingJobId);
        }

        console.log(`Received heartbeat from worker ${workerId}:`, status);
        return res.json({ status: 'ok' });
      }
    );

    /**
     * 1) GET /job/next
     *    - Returns 204 if no job available
     *    - Otherwise returns the next job in JSON
     */
    this.app.get('/job/next', async (_req: Request, res: Response) => {
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
     * 2) POST /job/:id/proved
     *    - External worker notifies that a job has been proved (or has failed).
     */
    this.app.post('/job/:id/proved', async (req: Request, res: Response) => {
      const jobId = req.params.id;
      let provingResult: TxProvingOutput = req.body;

      let tracker;
      try {
        tracker = this.jobTrackers.get(jobId);
        if (!tracker) {
          console.warn(`Job ${jobId} already completed or missing`);
          return res.status(200).json({
            status: 'ok',
            message: 'Job already completed or missing.',
          });
        }
        this.jobTrackers.delete(jobId);

        await this.mutex.runExclusive(async () => {
          await this.jobStore.markJobAsCompleted(jobId, provingResult);
        });
        console.log('tracker present', !!tracker.proving.resolver);
        console.log(
          'passing results ok proving. Success: ',
          provingResult.success
        );

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

function sanitizeForRoute(input: string): string {
  return input
    .normalize('NFD') // Normalize Unicode characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (accents)
    .replace(/[^a-zA-Z0-9\s_-]/g, '') // Remove non-alphanumeric except space, underscore, and hyphen
    .trim() // Trim leading/trailing spaces
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .toLowerCase(); // Convert to lowercase
}
