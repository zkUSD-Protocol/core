/**
 * Represents a job with optional timeout settings.
 */
export interface AnyJob {
  id: string;
  assignmentTimeoutSec?: number;
}

/**
 * An interface for storing, retrieving, and updating proving jobs.
 */
export interface JobStore<J extends AnyJob> {
  /**
   * Inserts a new job into the store.
   */
  addJob(job: J): Promise<void>;

  /**
   * Returns the next available job for proving (or `undefined` if none).
   */
  getNextAvailableJob(): Promise<J | undefined>;

  /**
   * Marks a job as assigned (so it’s no longer available).
   */
  markJobAsAssigned(jobId: string): Promise<void>;

  /**
   * Marks a job as completed and accepts a result or proof artifact.
   */
  markJobAsCompleted(jobId: string, result: unknown): Promise<void>;

  /**
   * Marks a job as assigned (so it’s no longer available).
   */
  markJobAsBeingProven(jobId: string): Promise<void>;

  /**
   * (Optional) Retrieve job status/result.
   */
  getJobStatus(
    jobId: string
  ): Promise<{ assigned: boolean; result?: unknown; completed: boolean }>;
}
