import { TestHelper } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import { WithDefault } from '../../../types/utility.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import assert from 'node:assert';
import { fetchAccount } from 'o1js';

const DEBUG = !!process.env.DEBUG;
const printTx = DEBUG && true;

const debugLog = (msg: string) => {
  if (DEBUG) {
    console.debug(msg);
  }
};

describe('zkUSD Integration - Concurrent Functional - Happy Path - Contract Admin ', () => {
  let th: TestHelper<'local' | 'external'>;
  let stop: () => void;

  before(async () => {
    const stopExecutor = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const txExecutorInitializers: WithDefault<
      'local' | 'external',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > = {
      local: async () => new LocalTransactionExecutor(),
      external: ExternalTransactionExecutor.initializer({
        prover: new HttpServerProver(),
        stop: stopExecutor,
      }),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });
  });

  after(async () => {
    stop();
  });

  it('should have deployed the contracts', async () => {
    await th.deployTokenContracts();
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
      }
    );
    assert.notStrictEqual(engineTokenAccount, undefined);
  });

  it('Can toggle stop protocol and back', async () => {
    // determine the current protocol state

    await fetchAccount({ publicKey: th.engine.contract.address });
    const stopped = th.engine.contract.isEmergencyStopped().toBoolean();

    if (stopped) {
      debugLog('Protocol is stopped, resuming first...');
      await th.includeEngineTx(
        th.deployer,
        {
          transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
          args: {
            transactionId: `Pre-test resuming the protocol`,
            shouldStop: false,
          },
        },
        { printTx, extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
      );
      debugLog('Protocol resumed...');
    }

    // now stop and resume
    debugLog('Protocol stopping...');
    await th.includeEngineTx(
      th.deployer,
      {
        transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
        args: {
          transactionId: `Stopping the protocol`,
          shouldStop: true,
        },
      },
      { printTx, extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
    );

    debugLog('Protocol resuming...');
    await th.includeEngineTx(
      th.deployer,
      {
        transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
        args: {
          transactionId: `Resuming the protocol`,
          shouldStop: false,
        },
      },
      { printTx, extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
    );
  });
});
