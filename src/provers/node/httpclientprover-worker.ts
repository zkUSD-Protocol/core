import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { blockchain } from '../../mina/networks.js';
import { getNetworkKeys } from '../../config/keys.js';
import { Mutex } from '../../utils/mutex.js';
import { TxProvingInput, TxProvingOutput } from '../itransactionprover.js';
import {
  CompilationResults,
  compileContracts,
  proveTransaction,
  TxProvingTracker,
} from '../../transaction/execution.js';
import { FailedBeforeSending } from '../../transaction/status.js';

type TxProvingRequest = {
  payload: TxProvingInput;
};

type TxProvingResponse = {
  result: TxProvingOutput;
};

function mkExecutionTracker() {
  let resolve: (value: TxProvingOutput) => void;
  let reject: (reason: TxProvingOutput) => void;
  const result = new Promise<TxProvingOutput>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const tracker: TxProvingTracker = {
    proving: {
      resolver: async (serializedTx: string) => {
        const res: TxProvingOutput = {
          success: true,
          serializedProvenTransaction: serializedTx,
        };
        resolve(res);
      },
      rejector: async (error: { status: FailedBeforeSending }) => {
        const res: TxProvingOutput = {
          success: false,
          errors: error.status.errors,
        };
        reject(res);
      },
    },
  };

  return { tracker, result };
}

const mkWorkerId = () => {
  const now = new Date();
  return `httpserver-worker-${now.toISOString()}`;
};

/**
 * Basic HTTP request handler:
 *  - Only accepts POST requests
 *  - Expects a TxProvingRequest JSON in the body
 *  - Calls proveTransaction on the prover
 *  - Returns a TxProvingResponse JSON on success
 */
function mkHandleRequest(
  chainInterface: MinaNetworkInterface,
  compiledContracts: CompilationResults,
  keys: ReturnType<typeof getNetworkKeys>
) {
  const workerId = mkWorkerId();
  const mutex = new Mutex();

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST instead.' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const parsedBody = JSON.parse(body) as TxProvingRequest;
        const { payload } = parsedBody;

        const context = {
          workerId,
          chain: chainInterface,
          args: payload,
          keys,
          compilationResults: compiledContracts,
        };

        let { tracker, result } = mkExecutionTracker();

        const provingResult = await mutex.runExclusive(async () => {
          await proveTransaction(
            context,
            JSON.stringify({
              signedData: payload.transaction.signedZkappCommand.data,
              serializedTx: payload.transaction.serializedTx,
            }),
            tracker
          );
          return await result;
        });

        const response: TxProvingResponse = { result: provingResult };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error: unknown) {
        console.error('Error in /proveTransaction:', error);
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Transaction proving failed: ${message}` }));
      }
    });
  }

  return handleRequest;
}

const __filename = fileURLToPath(import.meta.url);

// Create server instance
export const server = (
  chainInterface: MinaNetworkInterface,
  compiledContracts: CompilationResults,
  keys: ReturnType<typeof getNetworkKeys>
) => createServer(mkHandleRequest(chainInterface, compiledContracts, keys));

// Ensure top-level await is wrapped in an async function to ensure ES2021 module compat
if (process.argv[1] === __filename) {
  (async () => {
    const PORT = process.argv[2] || process.env.PORT || 3969;
    const CHAIN = process.argv[3] || process.env.CHAIN || 'lightnet';

    console.log(
      `Starting zkusd transaction proving server on port ${PORT} for chain ${CHAIN}...`
    );

    const chainInterface = await MinaNetworkInterface.initChain(CHAIN as blockchain);
    console.log('Compiling contracts');

    const keys = getNetworkKeys(CHAIN as blockchain);

    const compilationResults = await compileContracts({
      tokenPublicKey: keys.token.publicKey,
      enginePublicKey: keys.engine.publicKey,
    });

    server(chainInterface, compilationResults, keys).listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })();
}
