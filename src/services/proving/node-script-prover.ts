/**
  * This script is used to run a Node.js script as an external prover process.
  * It is a simple example of how to run a prover in a separate process using Node.js.
  *
  * The script is executed with the following command:
  * ```
  * node node-script-prover.ts <external prover manager url>
  * ```
  *
  * The script will run in a loop, polling the external prover manager for new jobs.
  * When a job is received, the script will process the job and submit the result back to the manager.
  */
import { ChildProcess, spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import { AnyProvingJob, ProvingJob, ProvingJobResult, ProvingJobType } from './shared-types.js';
import { TransactionProver } from './transaction-prover.js';

// Resolve the correct file path
const __filename = fileURLToPath(import.meta.url);

export class NodeScriptProver {
  private index?: number;
  private process?: ChildProcess;
  private exitCallback?: (code: number | null, signal: string | null) => void;

  constructor(private scriptPath: string = __filename) {}

  get proverId(): string {
    return `node-script-prover${this.index !== undefined ? `-${this.index}` : ''}`;
  }

  spawn(serverUrl: string, proverIndex?: number): void {
    if (!serverUrl) {
      throw new Error('Server URL is required to spawn the worker');
    }

    this.index = proverIndex;
    this.process = spawn('node', [this.scriptPath, serverUrl], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.process.stdout?.on('data', (data) =>
      console.log(`Prover #${proverIndex} stdout: ${data}`)
    );
    this.process.stderr?.on('data', (data) =>
      console.error(`Prover #${proverIndex} stderr: ${data}`)
    );

    this.process.on('exit', (code, signal) => {
      if (this.exitCallback) {
        this.exitCallback(code, signal);
      }
    });
  }

  onExit(callback: (exitCode: number | null, signal: string | null) => void): void {
    this.exitCallback = callback;
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }
}

/**
 * If this script is executed directly (not imported as a module), act as a worker.
 */
if (process.argv[1] === __filename) {
  const EPM_BASE_URL = process.argv[2];

  const prover = new TransactionProver();

  if (!EPM_BASE_URL) {
    console.error(`Usage: node ${__filename} <external prover manager url>`);
    process.exit(1);
  }

  console.log(`ExternalProcess started. Polling for jobs at ${EPM_BASE_URL}...`);

  async function main() {
    while (true) {
      try {
        // Request the next available job from the EPM using fetch
        const response = await fetch(`${EPM_BASE_URL}/jobs/next`);

        if (response.status === 204) {
          await sleep(2000);
          continue;
        }

        if (!response.ok) {
          console.error(`Failed to fetch job, status: ${response.status}`);
          await sleep(2000);
          continue;
        }

        const job: AnyProvingJob = await response.json();
        console.log(`Got job: ${job.id}, type=${job.type}`);

        // Process the job and generate a proof.
        const proofResult = await performProof(job);

        // Submit the proof result back to the EPM using fetch
        const submitResponse = await fetch(`${EPM_BASE_URL}/jobs/${job.id}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: proofResult }),
        });

        if (!submitResponse.ok) {
          console.error(`Failed to submit job result, status: ${submitResponse.status}`);
        } else {
          console.log(`Submitted result for job ${job.id}`);
        }
      } catch (err) {
        console.error('Error in ExternalProcess loop:', err);
        await sleep(2000);
      }
    }
  }

  async function proveTransaction(job: ProvingJob[ProvingJobType.ProveTransaction]): Promise<ProvingJobResult[ProvingJobType.ProveTransaction]> {
    await sleep(1000);
    return await prover.proveJob(job);
  }

  async function performProof(job: AnyProvingJob): Promise<unknown> {
    switch (job.type) {
      case ProvingJobType.ProveTransaction:
        return proveTransaction(job);
      default:
        throw new Error(`Unsupported job type: ${job.type}`);
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  main().catch((err) => {
    console.error(`Fatal error in ExternalProcess:`, err);
    process.exit(1);
  });
}
