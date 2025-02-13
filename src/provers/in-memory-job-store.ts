import { AnyJob, JobStore } from './job-store.js';
import { Mutex } from '../utils/mutex.js';

/**
 * Represents an entry in the in-memory job store.
 */
interface InMemoryStoreEntry<J> {
  job: J;
  assigned: boolean;
  assignedAt?: number;
  completed: boolean;
  result?: unknown;
}

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
  private readonly defaultTimeoutMs: number;

  /**
   * Creates an `InMemoryJobStore` instance.
   *
   * @param defaultTimeoutMs - Default job timeout in milliseconds.
   */
  constructor(defaultTimeoutMs: number) {
    this.defaultTimeoutMs = defaultTimeoutMs;
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

        const timeout = entry.job.assignmentTimeoutMs ?? this.defaultTimeoutMs;

        if (
          entry.assigned &&
          entry.assignedAt !== undefined &&
          now - entry.assignedAt > timeout
        ) {
          // Job timed out; reset its assignment status
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
