
// shared-types.ts
export enum ProvingJobType {
  ProveTransaction = 'ProveTransaction',
  ProveAndSendTransaction = 'ProveAndSendTransaction',
}

export interface ProveTransactionJobPayload {
  serializedTransaction: string;
  // vaultTransactionType: VaultTransactionType;
}
export type ProveAndSendTransactionResult = {error: string} | {txHash: string};

export interface ProveTransactionResult {

}

export type ProvingJobPayload = {
  [ProvingJobType.ProveTransaction]: ProveTransactionJobPayload;
  [ProvingJobType.ProveAndSendTransaction]: ProveTransactionJobPayload;
};

export type ProvingJobResult = {
  [ProvingJobType.ProveTransaction]: ProveTransactionResult;
  [ProvingJobType.ProveAndSendTransaction]: ProveAndSendTransactionResult;
};

export type ProvingJob = {
  [ProvingJobType.ProveTransaction]: ProvingJobDefinition<ProvingJobType.ProveTransaction>;
  [ProvingJobType.ProveAndSendTransaction]: ProvingJobDefinition<ProvingJobType.ProveAndSendTransaction>;
};

// Our minimal structure for a job.
interface ProvingJobDefinition<T extends ProvingJobType> {
  id: string;
  type: T;
  payload: ProvingJobPayload[T];

  /**
   * Assignment timeout (in milliseconds).
   * Defaults could be set at job-creation time by the manager.
   */
  assignmentTimeoutMs: number;
}

// A union covering all possible job variants (future-proof).
export type AnyProvingJob = ProvingJob[ProvingJobType.ProveTransaction | ProvingJobType.ProveAndSendTransaction];


/**
 * IProver can be parameterized by a subset (or all) of ProvingJobType.
 * - `SupportedTypes` is a union of job-type enum values (e.g., `ProvingJobType.ProveTransaction`)
 * - `supportedJobTypes` is an array of those enum values
 * - `proveJob` only accepts jobs whose `type` is in `SupportedTypes`
 *   and returns the matching result type from ProvingJobResult.
 */
export interface IProver<SupportedTypes extends ProvingJobType = ProvingJobType> {
  readonly supportedJobTypes: SupportedTypes[];

  proveJob<T extends SupportedTypes>(
    job: ProvingJob[T]
  ): Promise<ProvingJobResult[T]>;
}
