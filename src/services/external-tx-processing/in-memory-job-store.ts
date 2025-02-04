import { AnyProvingJob } from './shared-types.js';
import { JobStore } from './job-store.js';
import { Mutex } from '../../utils/mutex.js';

interface InMemoryStoreEntry {
  job: AnyProvingJob;
  assigned: boolean;
  assignedAt?: number;
  completed: boolean;
  result?: unknown;
}

export class InMemoryJobStore implements JobStore {
  private jobs: Map<string, InMemoryStoreEntry> = new Map();
  private mutex = new Mutex();
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  public async addJob(job: AnyProvingJob): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.jobs.set(job.id, {
        job,
        assigned: false,
        completed: false,
      });
    });
  }

  /**
   * Returns the next unassigned job. If a job is assigned but has timed out,
   * we "unassign" it so it can be taken by another worker.
   */
  public async getNextAvailableJob(): Promise<AnyProvingJob | undefined> {
    return this.mutex.runExclusive(() => {
      const now = Date.now();

      for (const entry of this.jobs.values()) {
        // If job is completed, skip it
        if (entry.completed) continue;

        // If job is assigned but timed out, reclaim it
        const timeout = entry.job.assignmentTimeoutMs ?? this.defaultTimeoutMs;
        if (
          entry.assigned &&
          entry.assignedAt !== undefined &&
          now - entry.assignedAt > timeout
        ) {
          // "Unassign" the job
          entry.assigned = false;
          entry.assignedAt = undefined;
        }
      }

      // Now find the first unassigned & not-completed job
      for (const entry of this.jobs.values()) {
        if (!entry.assigned && !entry.completed) {
          return entry.job;
        }
      }

      return undefined;
    });
  }

  /**
   * Marks the job as assigned (so no other worker picks it).
   */
  public async markJobAsAssigned(jobId: string): Promise<void> {
    await this.mutex.runExclusive(() => {
      const entry = this.jobs.get(jobId);
      if (entry && !entry.completed) {
        entry.assigned = true;
        entry.assignedAt = Date.now();
      }
    });
  }

  /**
   * Marks the job as completed. If the job is already completed, we do nothing
   * (the second or third completion attempt won't crash or overwrite).
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
      if (!entry.completed) {
        entry.completed = true;
        entry.result = result;
      }
    });
  }

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
