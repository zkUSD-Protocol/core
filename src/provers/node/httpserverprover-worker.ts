#!/usr/bin/env node

import { getContractKeys } from '../../config/keys.js';
import { compileContracts } from '../../transaction/execution.js';
import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { HttpServerProverWorkerConfig, startProvingLoop } from '../httpserverprover-worker-shared.js';
import os from 'os';
import { blockchain } from '../../types/utility.js';

import { Mutex } from '../../utils/mutex.js';

// 1. Catch unhandled Promise rejections at the process level.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // Here you can decide if you want to forcibly restart the loop,
  // or just let the main() function handle it via its own try/catch.
  // For example:
  sleep(500);

  if (!config) {
    throw new Error('Config is not defined');
  }
  startProvingLoop(mutex, config);
});

// 2. Catch uncaught exceptions at the process level.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception thrown:', err);
  // Same choice: forcibly restart or let main() handle it
  sleep(500);

  if (!config) {
    throw new Error('Config is not defined');
  }
  startProvingLoop(mutex, config);
});

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // 1) Parse CLI arguments
  const EPM_BASE_URL = process.argv[2];
  const CHAIN = process.argv[3] as blockchain;

  if (!EPM_BASE_URL || !CHAIN) {
    console.error(
      `Usage: node ${process.argv[1]} <external manager url> <blockchain>`
    );
    process.exit(1);
  }

  // 2) Initialize
  main(EPM_BASE_URL, CHAIN).catch((err) => {
    console.error('Fatal error in NodeExecutor:', err);
  });
}

const mutex = new Mutex();

let config: HttpServerProverWorkerConfig | undefined;

/**
 * Main entry point that calls startProvingLoop(...).
 * If startProvingLoop throws, we catch it here, wait 2s, and try again.
 */
async function main(epmBaseUrl: string, chain: blockchain) {

  const workerId = `HttpServerProver-Worker-@-${os.hostname()}`;

  console.log(`Starting Node worker ${workerId}`);
  console.log(`Initializing chain interface: ${chain}`);

  const chainInterface = await MinaNetworkInterface.initChain(chain);

  console.log('Compiling contracts for the transaction execution worker');
  const keys = getContractKeys(chain);
  const compilationResults = await compileContracts({
    tokenPublicKey: keys.token,
    enginePublicKey: keys.engine,
  });

  console.log(
    `NodeScriptExecutor started. Polling for jobs at ${epmBaseUrl}...`
  );

  // 3) Create config object for the shared loop
  config = {
    workerId,
    epmBaseUrl,
    chainInterface,
    compilationResults,
    statusPostingIntervalMs: 2000,
  };

  try {
    // Start the infinite proving loop
    await startProvingLoop(mutex, config);

    // If startProvingLoop actually returns, we can handle that here
    // (normally it won't, because it's a while(true) loop).
  }
  catch (err) {
    console.error('[ERROR] startProvingLoop threw an error:', err);
    await sleep(500);
    await startProvingLoop(mutex, config);
  }
}

/**
 * Utility sleep
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
