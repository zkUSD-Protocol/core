import { getNetworkKeys } from '../../config/keys.js';
import { compileContracts } from '../../transaction/execution.js';
import { blockchain } from '../../mina/networks.js';
import { MinaNetworkInterface } from '../../mina/network-interface.js';
import {
  HttpServerProverWorkerConfig,
  startProvingLoop,
} from '../httpserverprover-worker-shared.js';

/**
 * This script is invoked via Node (e.g., `node node-executor.js <managerUrl> <blockchain>`).
 * We handle process.argv, read chain, etc., then delegate to the shared code.
 */

if (require.main === module) {
  // 1) Parse CLI arguments
  const EPM_BASE_URL = process.argv[2];
  const CHAIN = process.argv[3];

  if (!EPM_BASE_URL || !CHAIN) {
    console.error(
      `Usage: node ${__filename} <external manager url> <blockchain>`
    );
    process.exit(1);
  }

  // 2) Initialize
  main(EPM_BASE_URL, CHAIN).catch((err) => {
    console.error('Fatal error in NodeExecutor:', err);
    process.exit(1);
  });
}

/**
 * Main function for Node environment.
 */
async function main(epmBaseUrl: string, chain: string) {
  const workerId = `Mina-Tx-Executor-Worker-Node-${Date.now()}`;

  console.log(`Starting Node worker ${workerId}`);
  console.log(`Initializing chain interface: ${chain}`);

  const chainInterface = await MinaNetworkInterface.initChain(
    chain as blockchain
  );

  console.log('Compiling contracts for the transaction execution worker');
  const keys = getNetworkKeys(chain as blockchain);
  const compilationResults = await compileContracts({
    tokenPublicKey: keys.token.publicKey,
    enginePublicKey: keys.engine.publicKey,
  });

  console.log(
    `NodeScriptExecutor started. Polling for jobs at ${epmBaseUrl}...`
  );

  // 3) Create config object for the shared loop
  const config: HttpServerProverWorkerConfig = {
    workerId,
    epmBaseUrl,
    chainInterface,
    compilationResults,
    keys,
  };

  // 4) Start the shared loop
  await startProvingLoop(config);
}
