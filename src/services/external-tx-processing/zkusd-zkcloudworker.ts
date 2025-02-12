import { Cloud, zkCloudWorker } from 'zkcloudworker';
import { NetworkKeyPairs, getNetworkKeys } from '../../config/keys.js';
import {
  CompilationConfig,
  CompilationResults,
  ExecutedTx,
  ExecutorContext,
  compilationConfigIsEqual,
  compileContracts,
  executeTransaction,
} from './transaction-execution.js';
import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';
import { VaultTransactionType } from '../../types/cloud-worker.js';
import { TransactionStatus } from '../../mina/transaction-status.js';
import { Mutex } from '../../utils/mutex.js';
import { connect } from '@nats-io/transport-node';

/**
 * transaction proving and sending with zkCloudWorker
 */
export class ZkUsdCloudWorker extends zkCloudWorker {
  private static _mutex: Mutex = new Mutex();
  private static _compilationResults: CompilationResults;
  private static _compilationConfig: CompilationConfig;
  private static _chain: MinaNetworkInterface;

  constructor(cloud: Cloud) {
    super(cloud);
  }

  private get keys(): NetworkKeyPairs {
    return getNetworkKeys(this.cloud.chain);
  }

  private async compileContracts(): Promise<CompilationResults> {
    const currentConfig = {
      tokenPublicKey: this.keys.token.publicKey,
      enginePublicKey: this.keys.engine.publicKey,
    };
    if (!ZkUsdCloudWorker._compilationResults) {
      // we don't lock if contracts have already been compiled
      await ZkUsdCloudWorker._mutex.runExclusive(async () => {
        // if contracts have not been compiled yet
        if (!ZkUsdCloudWorker._compilationResults) {
          // check again inside the lock
          ZkUsdCloudWorker._compilationConfig = currentConfig;
          ZkUsdCloudWorker._compilationResults = await compileContracts(
            ZkUsdCloudWorker._compilationConfig
          );
        } // Contracts are compiled
      });
    }

    // Contracts have been compiled for different keys.
    if (
      !compilationConfigIsEqual(
        ZkUsdCloudWorker._compilationConfig,
        currentConfig
      )
    ) {
      throw new Error(
        'ZkUsdCloudWorker: Compilation keys mismatch. Contracts have been compiled for different keys'
      );
    }

    return ZkUsdCloudWorker._compilationResults;
  }

  private async getNetworkInterface(): Promise<MinaNetworkInterface> {
    if (!ZkUsdCloudWorker._chain) {
      // we don't acquire mutex if chain has already been initialized
      await ZkUsdCloudWorker._mutex.runExclusive(async () => {
        if (!ZkUsdCloudWorker._chain) {
          // check again after waiting for mutex
          ZkUsdCloudWorker._chain = await MinaNetworkInterface.initChain(
            this.cloud.chain
          );
        }
      });
    }
    if (ZkUsdCloudWorker._chain.network.chainId !== this.cloud.chain) {
      throw new Error('ZkUsdCloudWorker: Chain ID mismatch');
    }
    return ZkUsdCloudWorker._chain;
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    const task = this.cloud.task as VaultTransactionType;
    if (!this.cloud.args) {
      throw new Error('No args provided');
    }

    if (transactions.length === 0) {
      throw new Error('No transactions provided');
    }
    if (transactions.length > 1) {
      throw new Error('Only one transaction is supported');
    }

    const compilationResults = await this.compileContracts();
    const chain = await this.getNetworkInterface();

    // Build the context
    const context: ExecutorContext = {
      workerId: `ZkUsdCloudWorker(cloud_id: ${this.cloud.id}, job_id: ${this.cloud.jobId})`,
      chain,
      task,
      args: this.cloud.args,
      keys: this.keys,
      compilationResults,
    };

    let ret: { txId: string; txStatus: TransactionStatus; hash?: string };

    const res = await executeTransaction(context, transactions[0]);
    console.log(
      `Transaction executed. Current status:\n${JSON.stringify(
        res.txStatus,
        null,
        2
      )}`
    );

    if (this.cloud.isLocalCloud && res.txStatus === 'Pending') {
      console.log('Awaiting inclusion...');
      const txIncluded = await res.pendingTx.safeWait();
      console.log(
        `one tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
      );
      console.log('txIncluded', txIncluded);
      ret = {
        txId: res.txId,
        txStatus: res.txStatus,
        hash: txIncluded.hash,
      };
      return JSON.stringify(ret);
    }
    const hash = extractTransactionHash(res);

    if (hash) {
      this.cloud.publishTransactionMetadata({
        txId: hash,
        metadata: {
          method: 'send',
        } as any,
      });
    }
    ret = {
      txId: res.txId,
      txStatus: res.txStatus,
      hash,
    };
    return JSON.stringify(ret);
  }
}

function extractTransactionHash(tx: ExecutedTx): string | undefined {
  if ('unprovenTx' in tx) {
    return undefined;
  }
  if ('provenTx' in tx) {
    return undefined;
  }
  if ('rejectedTx' in tx) {
    return tx.rejectedTx?.hash;
  }
  if ('pendingTx' in tx) {
    return tx.pendingTx?.hash;
  }
  return undefined;
}
