// external-process-manager.ts
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


// TODO rename to ExternalTxExecutor
export class ExternalProcessManager {
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
