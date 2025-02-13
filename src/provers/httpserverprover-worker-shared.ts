import { MinaNetworkInterface } from '../mina/network-interface.js';
import {
  compileContracts,
  ExecutorContext,
  proveTransaction,
  TxProvingTracker,
} from '../transaction/execution.js';
import { FailedBeforeSending } from '../transaction/status.js';
import {
  TransactionProvingJob,
  TxProvingOutput,
} from './itransactionprover.js';

// Common config needed by both Node & Web
export interface HttpServerProverWorkerConfig {
  workerId: string;
  epmBaseUrl: string;
  chainInterface: MinaNetworkInterface;
  compilationResults: Awaited<ReturnType<typeof compileContracts>>;
  keys: any; // Replace 'any' with the actual type from getNetworkKeys
}

/**
 * Main loop to poll for new jobs and prove transactions.
 * This is the same logic for both Node and Web.
 */
export async function startProvingLoop(config: HttpServerProverWorkerConfig) {
  const { workerId, epmBaseUrl, chainInterface, compilationResults, keys } =
    config;

  while (true) {
    try {
      const job = await fetchNextJob(epmBaseUrl);
      if (!job) {
        // No jobs available; wait a bit
        await sleep(2000);
        continue;
      }

      console.log(`Worker ${workerId} got job: ${job.id}`);

      // Build context for proving
      const context: ExecutorContext = {
        workerId,
        chain: chainInterface,
        args: job.payload,
        keys,
        compilationResults,
      };

      const executionTracker = mkExecutionTracker(epmBaseUrl, job.id);

      console.log(JSON.stringify(job.payload));

      await proveTransaction(
        context,
        JSON.stringify({
          signedData: job.payload.transaction.signedZkappCommand.data,
          serializedTx: job.payload.transaction.serializedTx,
        }),
        executionTracker
      );
    } catch (err) {
      console.error('Error in proving loop:', err);
      await sleep(2000);
    }
  }
}

/**
 * Creates a TxProvingTracker to POST results back to the manager.
 */
function mkExecutionTracker(
  epmBaseUrl: string,
  jobId: string
): TxProvingTracker {
  return {
    proving: {
      resolver: async (serializedTx: string) => {
        const res: TxProvingOutput = {
          success: true,
          serializedProvenTransaction: serializedTx,
        };
        await postBackResults(epmBaseUrl, `/jobs/${jobId}/proved`, res);
      },
      rejector: async (error: { status: FailedBeforeSending }) => {
        const res: TxProvingOutput = {
          success: false,
          errors: error.status.errors,
        };
        await postBackResults(epmBaseUrl, `/jobs/${jobId}/proved`, res);
      },
    },
  };
}

/**
 * Fetch the next job from the manager.
 */
async function fetchNextJob(
  epmBaseUrl: string
): Promise<TransactionProvingJob | null> {
  const resp = await fetch(`${epmBaseUrl}/jobs/next`);
  if (resp.status === 204) {
    // no job
    return null;
  }
  if (!resp.ok) {
    console.error(`Failed to fetch next job, status: ${resp.status}`);
    return null;
  }
  return (await resp.json()) as TransactionProvingJob;
}

/**
 * POST results back to the manager.
 */
async function postBackResults(epmBaseUrl: string, url: string, body: any) {
  await fetch(`${epmBaseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Utility sleep
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
