import { fetchLastBlock } from 'o1js';
import {
  TransactionStatusesQueryResponse,
  mkTransactionStatusesQuery,
} from '../mina/graphql.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import { RejectedOnInclusion } from './status.js';

export {
  ITransactionStatusScanner,
  TransactionStatusScanner,
  TransactionStatusScannerConfig,
};

const DEBUG = !!process.env.DEBUG;

/**
 * Logs debug messages if `DEBUG` is enabled.
 * Otherwise, it does nothing.
 * @param {...any} args - The arguments to log
 */
const logDebug = (...args: any[]) => {
  if (DEBUG) console.debug(...args);
};

type Inclusion = 'Included' | RejectedOnInclusion;

interface ITransactionStatusScanner {
  /**
   * Waits for a transaction to be included or rejected.
   * If the transaction is not found before the timeout, the promise is rejected.
   * @param transactionHash - The transaction hash to track
   * @param timeout - The timeout duration in milliseconds
   */
  awaitTransactionStatus(
    transactionHash: string,
    timeoutMs: number
  ): Promise<Inclusion>;

  /**
   * Starts scanning the blockchain for new transactions.
   */
  startScanning(): Promise<void>;

  /**
   * Stops the scanning process.
   */
  stopScanning(): Promise<void>;
}

type TransactionStatusScannerConfig = {
  /**
   * The expected block production time in seconds.
   */
  blockTimeMs: bigint;

  /**
   * Fetches the current blockchain length.
   */
  getBlockchainLength: () => Promise<bigint>;

  /**
   * Queries the last `lastBlocks` from the chain.
   * The response contains bestChain data in ascending or descending order.
   * @param lastBlocks - The number of recent blocks to fetch
   */
  queryTransactionStatuses: (
    lastBlocks: number
  ) => Promise<TransactionStatusesQueryResponse>;
};

const mkConfig = async (mina: IMinaNetworkInterface) => {
  return {
    blockTimeMs: mina.slotDuration.toBigInt(),
    getBlockchainLength: async () => {
      const latestBlock = await fetchLastBlock(mina.network.mina[0]);
      return latestBlock.blockchainLength.toBigint();
    },
    queryTransactionStatuses: async (lastBlocks: number) => {
      return mina.queryGraphQL(mkTransactionStatusesQuery({ lastBlocks }));
    },
  };
};

/**
 * Scans the blockchain for transaction statuses, resolving or rejecting promises
 * when a transaction is included or rejected.
 */
class TransactionStatusScanner implements ITransactionStatusScanner {
  private _mina: IMinaNetworkInterface;
  private _config: TransactionStatusScannerConfig | undefined;
  private _cache: Map<bigint, Map<string, Inclusion>> = new Map();
  private _resolvers: Map<string, (status: Inclusion) => void> = new Map();
  private _isScanning = false;

  private get config(): TransactionStatusScannerConfig {
    if (!this._config) {
      throw new Error('Config not loaded call startScanning first');
    }
    return this._config;
  }

  constructor(mina: IMinaNetworkInterface) {
    this._mina = mina;
  }

  /**
   * Returns the latest cached block height.
   */
  public get lastBlock(): bigint {
    return this._cache.size === 0
      ? 0n
      : BigInt(Math.max(...Array.from(this._cache.keys()).map(Number)));
  }

  /**
   * Starts scanning for new blocks and transactions.
   * Ensures that scanning only starts if not already running.
   */
  public async startScanning(): Promise<void> {
    this._config = await mkConfig(this._mina);
    if (this._isScanning) return;
    this._isScanning = true;
    this.doScan();
  }

  /**
   * Stops scanning for new transactions.
   */
  public async stopScanning(): Promise<void> {
    this._isScanning = false;
  }

  /**
   * Waits for a transaction to be included or rejected.
   * If the transaction is not found before the timeout, the promise is rejected.
   * @param transactionHash - The transaction hash to track
   * @param timeout - The timeout duration in milliseconds
   */
  public async awaitTransactionStatus(
    transactionHash: string,
    timeout: number
  ): Promise<Inclusion> {
    logDebug(`Awaiting transaction ${transactionHash}, timeout: ${timeout}ms`);

    for (const [blockNum, txMap] of this._cache.entries()) {
      if (txMap.has(transactionHash)) {
        const cachedStatus = txMap.get(transactionHash)!;
        logDebug(
          `Transaction ${transactionHash} found in cache at block ${blockNum}`
        );
        return cachedStatus;
      }
    }

    return new Promise<Inclusion>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._resolvers.delete(transactionHash);
        reject(
          new Error(
            `Transaction ${transactionHash} not found before awaiting timeout`
          )
        );
      }, timeout);

      this._resolvers.set(transactionHash, (status) => {
        clearTimeout(timeoutHandle);
        this._resolvers.delete(transactionHash);
        resolve(status);
      });
    });
  }

  /**
   * Parses a transaction query response and returns a map of transaction statuses.
   * @param resp - The GraphQL response containing transaction data
   */
  private parseQueryResponse(
    resp: TransactionStatusesQueryResponse
  ): Map<string, Inclusion> {
    const result = new Map<string, Inclusion>();

    if (!resp?.bestChain?.length) {
      logDebug('Warning: bestChain is missing or empty');
      return result;
    }

    for (const block of resp.bestChain) {
      if (!block.transactions) continue;

      for (const zkapp of block.transactions.zkappCommands || []) {
        const errors: string[] = this.extractFailureReasons(
          zkapp.failureReason
        );
        result.set(
          zkapp.hash,
          errors.length ? { kind: 'RejectedOnInclusion', errors } : 'Included'
        );
      }

      for (const userCommand of block.transactions.userCommands || []) {
        const errors: string[] = this.extractFailureReasons(
          userCommand.failureReason
        );
        result.set(
          userCommand.hash,
          errors.length ? { kind: 'RejectedOnInclusion', errors } : 'Included'
        );
      }
    }

    return result;
  }

  /**
   * Extracts failure reasons from a transaction response.
   * Handles both single failure objects and arrays of failures.
   * @param failureReason - The failure reason data
   */
  private extractFailureReasons(failureReason: any): string[] {
    if (!failureReason) return [];

    if (Array.isArray(failureReason)) {
      return failureReason.flatMap((item) =>
        Array.isArray(item.failures) ? item.failures : []
      );
    }

    if (
      typeof failureReason === 'object' &&
      Array.isArray(failureReason.failures)
    ) {
      return failureReason.failures;
    }

    return [];
  }

  /**
   * Periodically scans for new transactions in the blockchain.
   * Updates the cache and resolves promises when transactions are found.
   */
  private async doScan(): Promise<void> {
    if (!this._isScanning) return;

    try {
      const chainLength = await this.config.getBlockchainLength();
      const cachedLastBlock = this.lastBlock;
      const fromBlock =
        cachedLastBlock === 0n && chainLength > 20n
          ? chainLength - 19n
          : cachedLastBlock + 1n;

      const lastBlocks = chainLength - fromBlock + 1n;
      if (lastBlocks > 0n) {
        const response = await this.config.queryTransactionStatuses(
          Number(lastBlocks)
        );
        this.processNewBlocks(response, fromBlock);
      }

      this.keepLastXBlocks(100);
      setTimeout(() => this.doScan(), Number(this.config.blockTimeMs));
    } catch (err) {
      this._isScanning = false;
      throw err;
    }
  }

  /**
   * Processes new blocks and updates the transaction cache.
   * @param response - The transaction status response
   * @param fromBlock - The block number from which the scan started
   */
  private processNewBlocks(
    response: TransactionStatusesQueryResponse,
    fromBlock: bigint
  ) {
    response.bestChain.forEach((block, i) => {
      const blockIndex = fromBlock + BigInt(i);
      const txMap = this.parseQueryResponse({
        version: response.version,
        bestChain: [block],
      });
      this._cache.set(blockIndex, txMap);

      for (const [txHash, status] of txMap.entries()) {
        const resolver = this._resolvers.get(txHash);
        if (resolver) {
          resolver(status);
          this._resolvers.delete(txHash);
        }
      }
    });
  }

  /**
   * Removes old blocks from the cache, keeping only the last `x` blocks.
   * @param x - The number of blocks to retain
   */
  private keepLastXBlocks(x: number) {
    if (this._cache.size <= x) return;
    const blocksToRemove = Array.from(this._cache.keys())
      .sort((a, b) => Number(a - b))
      .slice(0, this._cache.size - x);

    blocksToRemove.forEach((blockNum) => this._cache.delete(blockNum));
  }
}
