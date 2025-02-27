// TODO untested! this is a POC!
import { getContractKeys } from '../../config/keys.js';
import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { blockchain } from '../../mina/networks.js';
import { compileContracts } from '../../transaction/execution.js';
import { Mutex } from '../../utils/mutex.js';
import {
  HttpServerProverWorkerConfig,
  WorkerJobContext,
  startProvingLoop,
  startStatusPostingLoop,
} from '../httpserverprover-worker-shared.js';
import { TransactionProvingJob } from '../itransactionprover.js';

const mutex = new Mutex();

let _job: TransactionProvingJob | null = null;
const jobContext: WorkerJobContext = {
  set: (job: TransactionProvingJob) => {
    _job = job;
  },
  unset: () => {
    _job = null;
  },
  get: () => _job,
};

// We'll listen for an initial message from the main thread, providing the manager URL & chain.
self.addEventListener('message', async (event) => {
  const { epmBaseUrl, chain } = event.data ?? {};

  if (!epmBaseUrl || !chain) {
    console.error(
      'Worker received invalid parameters: expected { epmBaseUrl, chain }.'
    );
    self.close();
    return;
  }

  const workerId = `Mina-Tx-Executor-Worker-Web-${Date.now()}`;

  console.log(`Starting Web Worker ${workerId} for chain ${chain}`);

  try {
    // 1) Initialize chain & keys
    const chainInterface = await MinaNetworkInterface.initChain(
      chain as blockchain
    );
    const keys = getContractKeys(chain as blockchain);
    const compilationResults = await compileContracts({
      tokenPublicKey: keys.token,
      enginePublicKey: keys.engine,
    });

    // 2) Create shared config object
    const config: HttpServerProverWorkerConfig = {
      workerId,
      epmBaseUrl,
      chainInterface,
      compilationResults,
      statusPostingIntervalMs: 2000,
    };

    // 3) Start the shared loop
    setTimeout(async () => {
      await startStatusPostingLoop(config, jobContext);
    });

    await startProvingLoop(mutex, config, jobContext);
  } catch (err) {
    console.error('Fatal error in Web Worker:', err);
    // Optionally close the worker
    // self.close();
  }
});
