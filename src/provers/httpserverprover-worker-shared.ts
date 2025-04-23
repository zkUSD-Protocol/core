import { MinaNetworkInterface } from '../mina/network-interface.js';
import {
  compileContracts,
  ExecutorContext,
  proveTransaction,
  TxProvingTracker,
} from '../transaction/execution.js';
import { FailedBeforeSending } from '../transaction/status.js';
import { debugLog } from '../utils/debug.js';
import { Mutex } from '../utils/mutex.js';
import {
  TransactionProvingJob,
  TransactionProvingWorkerStatus,
  TxProvingOutput,
} from './itransactionprover.js';

// Common config needed by both Node & Web
export interface HttpServerProverWorkerConfig {
  workerId: string;
  epmBaseUrl: string;
  chainInterface: MinaNetworkInterface;
  compilationResults: Awaited<ReturnType<typeof compileContracts>>;
  statusPostingIntervalMs: number;
}

// make interface based on _CurrentJob
export interface WorkerJobContext {
  set: (job: TransactionProvingJob) => void;
  unset: () => void;
  get: () => TransactionProvingJob | null;
}

/**
 * Main loop to poll for new jobs and prove transactions.
 * This is the same logic for both Node and Web.
 */
export async function startProvingLoop(
  mutex: Mutex,
  config: HttpServerProverWorkerConfig,
  workerJobContext: WorkerJobContext
) {
  const { workerId, epmBaseUrl, chainInterface, compilationResults } = config;

  await mutex.runExclusive(async () => {
    while (true) {
      try {
        debugLog(`Worker ${workerId} polling for jobs...`);
        const job = await fetchNextJob(epmBaseUrl);
        if (!job) {
          // No jobs available; wait a bit
          await sleep(2000);
          continue;
        }
        workerJobContext.set(job);
        console.log(`Worker ${workerId} got job: ${job.id}`);

        // Build context for proving
        const context: ExecutorContext = {
          workerId,
          chain: chainInterface,
          args: job.payload,
          compilationResults,
        };

        const executionTracker = mkExecutionTracker(
          epmBaseUrl,
          job.id,
          workerJobContext
        );

        await proveTransaction(
          context,
          JSON.stringify({
            signedData: job.payload.transaction.signedZkappCommand.data,
            serializedTx: job.payload.transaction.serializedTx,
          }),
          executionTracker
        );
      } catch (err) {
        workerJobContext.unset();
        console.error('Error in proving loop:', err);
        await sleep(2000);
      }
    }
  });
}

export async function startStatusPostingLoop(
  config: HttpServerProverWorkerConfig,
  workerJobContext: WorkerJobContext
) {
  console.log('Starting status posting loop');
  const { workerId, epmBaseUrl, statusPostingIntervalMs: interval } = config;

  while (true) {
    try {
      await sleep(interval);
      await postProvingStatus(epmBaseUrl, workerId, workerJobContext);
    } catch (err) {
      console.error('Error in status posting loop:', err);
    }
  }
}

async function postProvingStatus(
  epmBaseUrl: string,
  workerId: string,
  workerJobContext: WorkerJobContext
) {
  try {
    const jobId = workerJobContext.get()?.id;
    const status: TransactionProvingWorkerStatus = jobId
      ? { provingJobId: jobId, proving: true as const }
      : { proving: false as const };

    console.log(`Posting proving status: ${JSON.stringify(status)}`);
    await postBackResults(epmBaseUrl, `/worker/${workerId}/heartbeat`, {
      status,
    });
  } catch (e) {
    console.error('Error posting proving status:', e);
  }
}

/**
 * Creates a TxProvingTracker to POST results back to the manager.
 */
function mkExecutionTracker(
  epmBaseUrl: string,
  jobId: string,
  workerJobContext: WorkerJobContext
): TxProvingTracker {
  return {
    proving: {
      resolver: async (serializedTx: string) => {
        const res: TxProvingOutput = {
          success: true,
          serializedProvenTransaction: serializedTx,
        };
        await postBackResults(epmBaseUrl, `/job/${jobId}/proved`, res);
        workerJobContext.unset();
      },
      rejector: async (error: { status: FailedBeforeSending }) => {
        const res: TxProvingOutput = {
          success: false,
          errors: error.status.errors,
        };
        console.log('postback results for: ', jobId, 'succes', res.success);
        await postBackResults(epmBaseUrl, `/job/${jobId}/proved`, res);
        workerJobContext.unset();
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
  const resp = await fetch(`${epmBaseUrl}/job/next`);
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
  // debug log
  await fetch(`${epmBaseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify(body),
  });
}

/**
 * Utility sleep
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
