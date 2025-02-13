import { getNetworkKeys } from '../../config/keys.js';
import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { blockchain } from '../../mina/networks.js';
import { compileContracts } from '../../transaction/execution.js';
import {
  HttpServerProverWorkerConfig,
  startProvingLoop,
} from '../httpserverprover-worker-shared.js';

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
    const keys = getNetworkKeys(chain as blockchain);
    const compilationResults = await compileContracts({
      tokenPublicKey: keys.token.publicKey,
      enginePublicKey: keys.engine.publicKey,
    });

    // 2) Create shared config object
    const config: HttpServerProverWorkerConfig = {
      workerId,
      epmBaseUrl,
      chainInterface,
      compilationResults,
      keys,
    };

    // 3) Start the shared loop
    await startProvingLoop(config);
  } catch (err) {
    console.error('Fatal error in Web Worker:', err);
    // Optionally close the worker
    // self.close();
  }
});
