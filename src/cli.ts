#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Optional: if you need the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// Hard-coded paths to your Node scripts.
// Adjust these if the scripts are in a different location.
const HTTP_CLIENT_PROVER_WORKER = path.join(
  __dirname,
  'provers',
  'node',
  'httpclientprover-worker.js'
);
const HTTP_SERVER_PROVER_WORKER = path.join(
  __dirname,
  'provers',
  'node',
  'httpserverprover-worker.js'
);

// CLI metadata
program
  .name('zkusd-prover-workers')
  .description('CLI to run the zkusd proving workers (client or server).')
  .version('0.1.0');

// --------------------------------------
// Command 1: server - which is worker for httpclientprover
// --------------------------------------
program
  .command('server')
  .description('Run the HTTP client prover worker.')
  .option('-p, --port <port>', 'Port to listen on (default 3969)', '3969')
  .option(
    '-c, --chain <chain>',
    'Blockchain name (default "lightnet")',
    'lightnet'
  )
  .action((options) => {
    const { port, chain } = options;

    console.log(
      `\n[zkusd-prover] Starting client worker on port ${port}, chain: ${chain}\n`
    );

    // Spawn the underlying Node script:
    const args = [HTTP_CLIENT_PROVER_WORKER, port, chain];
    const child = spawn('node', args, { stdio: 'inherit' });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[zkusd-prover] Client worker exited with code: ${code}`);
      }
    });
  });

// --------------------------------------
// Command 2: client  -  which is worker for httpseverprover
// --------------------------------------
program
  .command('client')
  .description(
    'Run the HTTP server prover worker (requires managerUrl and chain).'
  )
  .argument(
    '<managerUrl>',
    'URL of the external manager (e.g. http://localhost:3000)'
  )
  .argument('<chain>', 'Blockchain name (e.g. "lightnet")')
  .action((managerUrl, chain) => {
    console.log(
      `\n[zkusd-prover] Starting server worker with manager URL ${managerUrl}, chain: ${chain}\n`
    );

    // Spawn the underlying Node script:
    const args = [HTTP_SERVER_PROVER_WORKER, managerUrl, chain];
    const child = spawn('node', args, { stdio: 'inherit' });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[zkusd-prover] Server worker exited with code: ${code}`);
      }
    });
  });

// Parse the CLI arguments
program.parse(process.argv);
