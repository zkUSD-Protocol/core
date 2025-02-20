import { AnyJob, JobStore } from './job-store.js';
import { Mutex } from '../utils/mutex.js';

/**
 * Represents an entry in the in-memory job store.
 */
interface InMemoryStoreEntry<J> {
  job: J;
  assigned: boolean;
  assignedAt?: number;
  lastMarkedAsBeingProven?: number;
  completed: boolean;
  result?: unknown;
}

export type InMemoryJobStoreTimeouts = {
  maxTotalJobTimeSec: number; // if worker takes too much time it will be put back in the queue  maxTotalJobTimeSec: number;
  maxJobInactivitySec: number; // if worker does not mark as being proven in time, it will be put back in the queue
};

/**
 * An in-memory implementation of `JobStore`, designed for lightweight job tracking.
 *
 * Features:
 * - Thread-safe access via a `Mutex`
 * - Automatic reassignment of timed-out jobs
 * - Status tracking for jobs (assigned, completed, and results)
 */
export class InMemoryJobStore<J extends AnyJob> implements JobStore<J> {
  private jobs: Map<string, InMemoryStoreEntry<J>> = new Map();
  private mutex = new Mutex();
  private readonly timeouts: InMemoryJobStoreTimeouts;

  /**
   * Creates an `InMemoryJobStore` instance.
   *
   * @param totalJobTimeSec - Default job timeout in seconds.
   */
  constructor(args: { timeouts: InMemoryJobStoreTimeouts }) {
    this.timeouts = args.timeouts;
  }

  /**
   * Adds a new job to the store.
   *
   * @param job - The job to be added.
   */
  public async addJob(job: J): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (this.jobs.has(job.id)) {
        throw new Error(`Job with ID ${job.id} already exists.`);
      }
      this.jobs.set(job.id, {
        job,
        assigned: false,
        completed: false,
      });
    });
  }

  /**
   * Marks a job as assigned (so it’s no longer available).
   * Which just delays the timeout of the job.
   */
  public async markJobAsBeingProven(jobId: string): Promise<void> {
    return this.mutex.runExclusive(() => {
      const entry = this.jobs.get(jobId);
      if (!entry) {
        throw new Error(`Job not found: ${jobId}`);
      }
      if (entry.completed) {
        throw new Error(`Cannot assign completed job: ${jobId}`);
      }

      console.log(`marking ${entry.job.id} as being proven.`);
      entry.lastMarkedAsBeingProven = Date.now();
    });
  }

  /**
   * Retrieves the next available job that is either:
   *  1. Unassigned and not completed.
   *  2. Assigned but has exceeded its timeout, in which case it is reassigned.
   *
   * @returns The next available job, or `undefined` if none are available.
   */
  public async getNextAvailableJob(): Promise<J | undefined> {
    return this.mutex.runExclusive(() => {
      const now = Date.now();

      for (const entry of this.jobs.values()) {
        if (entry.completed) continue;

        const timeout =
          1000 *
          (entry.job.assignmentTimeoutSec ?? this.timeouts.maxTotalJobTimeSec);

        // time out if the worker takes too long
        let timeOut = false;
        if (
          entry.assigned &&
          entry.assignedAt !== undefined &&
          now - entry.assignedAt > timeout
        ) {
          // Job timed out; reset its assignment status
          console.log(
            `Job ${entry.job.id} total time as being assigned ran out. Putting back to the job queue...`
          );
          timeOut = true;
        }
        // imtermediate timeout if the worker does not mark as being proven in time
        // if it was never marked as being proven, it will have a few secs more
        else if (
          entry.assigned &&
          entry.assignedAt !== undefined &&
          entry.lastMarkedAsBeingProven === undefined &&
          now - entry.assignedAt >
            1000 * (5 + this.timeouts.maxJobInactivitySec)
        ) {
          // Job timed out; reset its assignment status
          console.log(
            `Assigned job ${entry.job.id} never marked as being proven. Putting back to the job queue...`
          );
          timeOut = true;
        } else if (
          entry.assigned &&
          entry.lastMarkedAsBeingProven !== undefined &&
          now - entry.lastMarkedAsBeingProven >
            1000 * this.timeouts.maxJobInactivitySec
        ) {
          console.log(
            `Assigned job ${entry.job.id} proving inactivity detected. Putting back to the job queue...`
          );
          timeOut = true;
        }
        if (timeOut) {
          entry.assigned = false;
          entry.assignedAt = undefined;
        }

        // If the job is unassigned and not completed, return it
        if (!entry.assigned) {
          return entry.job;
        }
      }

      return undefined;
    });
  }

  /**
   * Marks a job as assigned.
   *
   * @param jobId - The ID of the job to be assigned.
   * @throws If the job does not exist.
   */
  public async markJobAsAssigned(jobId: string): Promise<void> {
    await this.mutex.runExclusive(() => {
      const entry = this.jobs.get(jobId);
      if (!entry) {
        throw new Error(`Job not found: ${jobId}`);
      }
      if (entry.completed) {
        throw new Error(`Cannot assign completed job: ${jobId}`);
      }

      entry.assigned = true;
      entry.assignedAt = Date.now();
    });
  }

  /**
   * Marks a job as completed and stores the result.
   *
   * @param jobId - The ID of the job to complete.
   * @param result - The result of the completed job.
   * @throws If the job does not exist.
   */
  public async markJobAsCompleted(
    jobId: string,
    result: unknown
  ): Promise<void> {
    await this.mutex.runExclusive(() => {
      const entry = this.jobs.get(jobId);
      if (!entry) {
        throw new Error(`Job not found: ${jobId}`);
      }
      if (entry.completed) {
        console.warn(
          `Job ${jobId} was already completed. Ignoring duplicate completion.`
        );
        return;
      }

      entry.completed = true;
      entry.result = result;
    });
  }

  /**
   * Retrieves the status of a job, including its assignment and completion status.
   *
   * @param jobId - The ID of the job to query.
   * @returns An object containing `assigned`, `completed`, and optionally `result`.
   * @throws If the job does not exist.
   */
  public async getJobStatus(
    jobId: string
  ): Promise<{ assigned: boolean; result?: unknown; completed: boolean }> {
    return this.mutex.runExclusive(() => {
      const entry = this.jobs.get(jobId);
      if (!entry) {
        throw new Error(`Job not found: ${jobId}`);
      }
      return {
        assigned: entry.assigned,
        completed: entry.completed,
        result: entry.result,
      };
    });
  }
}
