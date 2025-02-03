// job-store.ts
import { AnyProvingJob } from './shared-types';

/**
 * An interface for storing, retrieving, and updating proving jobs.
 */
export interface JobStore {
  /**
   * Inserts a new job into the store.
   */
  addJob(job: AnyProvingJob): Promise<void>;

  /**
   * Returns the next available job for proving (or `undefined` if none).
   */
  getNextAvailableJob(): Promise<AnyProvingJob | undefined>;

  /**
   * Marks a job as assigned (so it’s no longer available).
   */
  markJobAsAssigned(jobId: string): Promise<void>;

  /**
   * Marks a job as completed and accepts a result or proof artifact.
   */
  markJobAsCompleted(jobId: string, result: unknown): Promise<void>;

  /**
   * (Optional) Retrieve job status/result.
   */
  getJobStatus(
    jobId: string
  ): Promise<{ assigned: boolean; result?: unknown; completed: boolean }>;
}
