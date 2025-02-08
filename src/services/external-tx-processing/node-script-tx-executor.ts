/**
 * node-script-executor.ts
 *
 * This script is run as an external worker that polls an TransactionWorkerManager for
 * "transaction execution" jobs in two phases: proving and sending.
 */

import { ChildProcess, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import {
  ExecutorContext,
  TxLifecycleTracker,
  compileContracts,
  executeTransaction,
} from './transaction-execution.js';
import { getNetworkKeys } from '../../config/keys.js';
import { blockchain } from 'zkcloudworker';
import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';
import { ProvingResult } from './shared-types.js';
import {
  FailedBeforeSending,
  RejectedOnReceive,
} from '../../mina/transaction-status.js';
import { TransactionExecutionJob } from './external-transaction-executor.js';
import { ExternalProcess } from './external-process.js';

// So we can handle script path references
const __filename = fileURLToPath(import.meta.url);

/**
 * This class is an adapter that spawns a separate Node.js process (this same file)
 * to act as a “transaction executor” worker.
 */
export class NodeScriptExecutor implements ExternalProcess {
  private index?: number;
  private process?: ChildProcess;
  private exitCallback?: (code: number | null, signal: string | null) => void;

  // By default, we spawn the same file. That’s how we run as a child worker.
  constructor(
    private chain: blockchain = 'lightnet',
    private scriptPath: string = __filename
  ) {}

  get proverId(): string {
    // For naming consistency, we can call it "executor" or keep "prover"
    return `node-script-executor${
      this.index !== undefined ? `-${this.index}` : ''
    }`;
  }

  /**
   * Spawns the child Node.js process with the given EPM url.
   */
  spawn(serverUrl: string, workerIndex?: number): void {
    if (!serverUrl) {
      throw new Error('Server URL is required to spawn the worker');
    }
    this.index = workerIndex;
    this.process = spawn('node', [this.scriptPath, serverUrl, this.chain], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.process.stdout?.on('data', (data) =>
      console.log(`[Worker #${workerIndex} stdout]: ${data}`)
    );
    this.process.stderr?.on('data', (data) =>
      console.error(`[Worker #${workerIndex} stderr]: ${data}`)
    );

    // If the child exits, call the exit callback if set
    this.process.on('exit', (code, signal) => {
      if (this.exitCallback) {
        this.exitCallback(code, signal);
      }
    });
  }

  onExit(
    callback: (exitCode: number | null, signal: string | null) => void
  ): void {
    this.exitCallback = callback;
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }
}

// This block only runs if the script is invoked directly from the command line:
// i.e. `node node-script-executor.js <manager-base-url>`
if (process.argv[1] === __filename) {
  // Run in "worker" mode
  const EPM_BASE_URL = process.argv[2];
  const CHAIN = process.argv[3];
  if (!EPM_BASE_URL || !CHAIN) {
    console.error(
      `Usage: node ${__filename} <external manager url> <blockchain>`
    );
    process.exit(1);
  }
  // use timestamp of creation in worker id
  const workerId = `Mina-Tx-Executor-Worker-${Date.now()}`;
  console.log(`Starting worker ${workerId}`);

  console.log(`Initializing chain interface: ${CHAIN}`);
  const chainInterface = await MinaNetworkInterface.initChain(
    CHAIN as blockchain
  );

  console.log('Compiling contracts for the transaction execution worker');

  const keys = getNetworkKeys(CHAIN as blockchain);

  // compile contracts
  const compilationResults = await compileContracts({
    tokenPublicKey: keys.token.publicKey,
    enginePublicKey: keys.engine.publicKey,
  });

  console.log(
    `NodeScriptExecutor started. Polling for jobs at ${EPM_BASE_URL}...`
  );

  async function main() {
    while (true) {
      try {
        // 1) Poll the manager for the next job
        const job = await fetchNextJob();
        if (!job) {
          // no jobs available; wait a bit
          await sleep(2000);
          continue;
        }

        console.log(`Got job: ${job.id}`);

        // Build the context
        const context: ExecutorContext = {
          workerId,
          chain: chainInterface,
          args: job.payload,
          keys,
          compilationResults,
        };

        let executionTracker: TxLifecycleTracker = mkExecutionTracker(job.id);

        await executeTransaction(
          context,
          JSON.stringify({
            signedData: job.payload.transaction.signedData.data,
            serializedTx: job.payload.transaction.serializedTx,
          }),
          executionTracker
        );
        // as our tracker does all the status communication
        // and we dont actually need the PendingTransaction
        // we may just discard the result
      } catch (err) {
        console.error('Error in external worker main loop:', err);
        await sleep(2000);
      }
    }
  }

  function mkExecutionTracker(jobId: string): TxLifecycleTracker {
    const ret: TxLifecycleTracker = {
      proving: {
        resolver: async (proofs: string[]) => {
          const res: ProvingResult = { success: true, proofs };
          await postToManager(`/jobs/${jobId}/proved`, res);
        },
        rejector: async (error: { status: FailedBeforeSending }) => {
          const res: ProvingResult = { success: false, status: error.status };
          await postToManager(`/jobs/${jobId}/proved`, res);
        },
      },
      sending: {
        resolver: async (res: { hash: string; status: 'Pending' }) => {
          await postToManager(`/jobs/${jobId}/sent`, res);
        },
        rejector: async (error: {
          status: RejectedOnReceive | FailedBeforeSending;
        }) => {
          await postToManager(`/jobs/${jobId}/sent`, error);
        },
      },
    };
    return ret;
  }

  async function postToManager(jobId: string, body: any) {
    await fetch(`${EPM_BASE_URL}/jobs/${jobId}/sending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function fetchNextJob(): Promise<TransactionExecutionJob | null> {
    const resp = await fetch(`${EPM_BASE_URL}/jobs/next`);
    if (resp.status === 204) {
      // no job
      return null;
    }
    if (!resp.ok) {
      console.error(`Failed to fetch next job, status: ${resp.status}`);
      return null;
    }
    return (await resp.json()) as TransactionExecutionJob;
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Start main loop
  main().catch((err) => {
    console.error(`Fatal error in NodeScriptExecutor:`, err);
    process.exit(1);
  });
}
