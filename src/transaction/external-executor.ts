import {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionArgs,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from './executor.js';
import {
  FailedBeforeSending,
  RejectedOnInclusion,
  RejectedOnReceive,
  TransactionStatus,
  TxLifecycleStatus,
  isTransactionStatus,
} from './status.js';
import { TrackedPromise } from '../utils/tracked-promise.js';
import {
  ITransactionProver,
  TxProvingInput,
} from '../provers/itransactionprover.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import {
  deserializeTransaction,
  serializeTransaction,
} from '../utils/transaction-serialization.js';
import {
  ITransactionStatusScanner,
  TransactionStatusScanner,
} from './status-scanner.js';
import { testnetMinaSigner } from '../signers/mina-signer.js';
import { Signed } from '../o1js-compat/signed.js';
import { SignerZkappCommand } from '../o1js-compat/zkappcommand.js';
import { Transaction } from 'o1js';
import { browserWalletSigner } from '../signers/browserwallet-signer.js';
import { isKeyPair } from '../mina/utils.js';

/**
 * An implementation of ITransactionExecutor that delegates transaction proving
 * and sending to an external manager via some scheduling mechanism.
 */
export class ExternalTransactionExecutor implements ITransactionExecutor {
  private constructor(
    private readonly prover: ITransactionProver,
    private readonly inclusionScanner: ITransactionStatusScanner
  ) {}

  /**
   * Provides an initializer function that can be passed
   * as a setup step to Mina network instances.
   */
  public static initializer(
    args: { prover: ITransactionProver },
    stop?: Promise<void>
  ) {
    return (mina: IMinaNetworkInterface) =>
      ExternalTransactionExecutor.start(mina, args, stop);
  }

  /**
   * Create and start an ExternalTransactionExecutor.
   */
  public static async start(
    mina: IMinaNetworkInterface,
    args: { prover: ITransactionProver },
    stop?: Promise<void>
  ): Promise<ExternalTransactionExecutor> {
    if (mina.network.chainId === 'local') {
      throw new Error(
        'ExternalTransactionExecutor cannot be used with a local chain.'
      );
    }

    const scanner = new TransactionStatusScanner(mina);
    const executor = new ExternalTransactionExecutor(args.prover, scanner);

    await executor.inclusionScanner.startScanning();

    await executor.prover.start();

    // If a stop signal is provided, stop this executor when resolved
    if (stop) {
      stop
        .then(() => executor.stop())
        .catch((err) => {
          console.error(
            'Error while stopping ExternalTransactionExecutor:',
            err
          );
        });
    }

    return executor;
  }

  /**
   * Gracefully stop scanning and shut down the worker manager (if any).
   */
  public async stop(): Promise<void> {
    await this.inclusionScanner.stopScanning();
    await this.prover.shutdown();
  }

  /**
   * Returns the global Mina-signer instance (e.g., for offline signing).
   */
  public get minaSigner() {
    return testnetMinaSigner;
  }

  /**
   * Returns the global Mina-signer instance (e.g., for offline signing).
   */
  public get browserWallerSigner() {
    return browserWalletSigner;
  }

  /**
   * Await the final chain status of a transaction by its hash.
   */
  private async awaitTx(
    hash: string,
    timeoutMs: number
  ): Promise<{ resolutionBlockHeight: bigint, resolution: 'Included' | RejectedOnInclusion }> {
    return this.inclusionScanner.awaitTransactionStatus(hash, timeoutMs);
  }

  public async executeTransaction(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig
  ): Promise<TransactionLifecycle> {
    if (!tx.args) {
      throw new Error(
        'Transaction args are required when using the external executor'
      );
    }
    const txArgs = tx.args as TransactionArgs;

    // Helpers for standardizing success/error shapes
    const wrapNoErrors = <T>(value: T & { status?: TransactionStatus }) => ({
      isLocal: false as const,
      ...value,
    });

    const wrapError = (err: {
      status: RejectedOnReceive | RejectedOnInclusion | FailedBeforeSending;
    }) => ({
      isLocal: false as const,
      errors: err.status.errors,
    });

    // Acquire a nonce lock to ensure a consistent nonce for this tx
    const nonceLock = isKeyPair(tx.keys.sender)
      ? await tx.nonceLock(tx.keys.sender.publicKey)
      : await tx.nonceLock(tx.keys.sender);

    let builtTxGlobal: Transaction<false, false>;
    let signedTxGlobal: Signed<SignerZkappCommand>;

    const signingPromise = new TrackedPromise<TxProvingInput>(async () => {
      const builtTx = await tx.buildTx;
      builtTxGlobal = builtTx;

      try {
        tx.setStatuses('unchanged' as const, TxLifecycleStatus.SIGNING);
        const signedTx = (
          isKeyPair(tx.keys.sender)
            ? await this.minaSigner({
              fee: config.startingFee,
              nonce: nonceLock.nonce,
              tx: builtTx,
              keys: {
                sender: tx.keys.sender,
                extraSigners: tx.keys.extraSigners,
              },
            })
            : await this.browserWallerSigner({
              fee: config.startingFee,
              nonce: nonceLock.nonce,
              tx: builtTx,
              keys: {
                sender: tx.keys.sender,
                extraSigners: tx.keys.extraSigners,
              },
            })
        ).signedTx;

        signedTxGlobal = signedTx;
        const ret: TxProvingInput = {
          txId: tx.getId(),
          transaction: {
            serializedTx: serializeTransaction(builtTx),
            signedZkappCommand: signedTx,
          },
          ...txArgs,
        };
        return ret;
      } catch (error) {
        const status: FailedBeforeSending = {
          kind: 'FailedBeforeSending',
          errors: [
            'Error when building or signing the tx',
            error instanceof Error ? error.message : String(error),
          ],
        };
        await nonceLock.unlock();
        tx.setStatuses(status, TxLifecycleStatus.FAILED);
        throw error;
      }
    });

    // ---- Proving Promise ----
    const provingPromise = new TrackedPromise<ProvenTransaction>(async () => {
      const input = await signingPromise;
      try {
        tx.setStatuses('unchanged' as const, TxLifecycleStatus.PROVING);
        const output = await this.prover.proveTransaction(input);
        if (output.success === false) {
          const status: FailedBeforeSending = {
            kind: 'FailedBeforeSending',
            errors: output.errors,
          };
          tx.setStatuses(status, TxLifecycleStatus.FAILED);
          if (config?.printTx) {
            console.log(
              `${tx.getId()} - Proving failed: ${JSON.stringify(status)}`
            );
          }
          await nonceLock.unlock();
          return wrapError({ status });
        } else {
          tx.setStatuses('unchanged' as const, TxLifecycleStatus.SCHEDULED);
          if (config?.printTx) {
            console.log(`${tx.getId()} - Proved.`);
          }
          return wrapNoErrors({
            serializedProvenTransaction: output.serializedProvenTransaction,
          });
        }
      } catch (error) {
        const errors = Array.isArray(error)
          ? error.map((e) => (e instanceof Error ? e.message : String(e)))
          : error instanceof Error
            ? [error.message]
            : [String(error)];

        const status: FailedBeforeSending = {
          kind: 'FailedBeforeSending',
          errors,
        };
        tx.setStatuses(status, TxLifecycleStatus.FAILED);
        if (config?.printTx) {
          console.log(
            `${tx.getId()} - Proving failed: ${JSON.stringify(status)}`
          );
        }
        await nonceLock.unlock();
        return wrapError({ status });
      }
    }, `Proving tx: ${tx.getId()}`);

    // ---- Sending Promise ----
    const sendingPromise = new TrackedPromise<SentTransaction>(async () => {
      try {
        const proveResult = await provingPromise;

        if (proveResult.isLocal) {
          throw new Error('isLocal should be false in external executor');
        }

        if ('serializedProvenTransaction' in proveResult) {
          const readyToSendTx = deserializeTransaction(
            proveResult.serializedProvenTransaction,
            builtTxGlobal,
            signedTxGlobal.data
          );

          // Send the transaction
          const sendResult = await readyToSendTx.safeSend();
          // unlock the nonce before returning
          await nonceLock.unlock();

          if (sendResult.status === 'rejected') {
            const status: RejectedOnReceive = {
              kind: 'RejectedOnReceive',
              errors: sendResult.errors,
            };
            if (config?.printTx) {
              console.log(
                `${tx.getId()} - Send failed: ${JSON.stringify(status)}`
              );
            }
            tx.setStatuses(status, TxLifecycleStatus.FAILED);
            return wrapError({ status });
          } else {
            if (config?.printTx) {
              console.log(
                `${tx.getId()} - Sent successfully. The tx is pending inclusion.`
              );
            }
            tx.setStatuses('Pending', TxLifecycleStatus.PENDING);
            return wrapNoErrors({ hash: sendResult.hash });
          }
        } else {
          // Proving failed
          const status: FailedBeforeSending = {
            kind: 'FailedBeforeSending',
            errors: ['Proving failed', ...proveResult.errors],
          };
          return wrapError({ status });
        }
      } catch (error) {
        await nonceLock.unlock();
        const stringError = error instanceof Error ? error.message : JSON.stringify(error);
        const status: FailedBeforeSending = {
          kind: 'FailedBeforeSending',
          errors: ['Exceptional failure', stringError],
        };
        tx.setStatuses(status, TxLifecycleStatus.FAILED);
        throw error;
      }
    }, `Sending tx: ${tx.getId()}`);

    // ---- Waiting Promise (chain inclusion) ----
    const waitingPromise = new TrackedPromise<AwaitedTransaction>(async () => {
      let sentTx;
      try {
        sentTx = await sendingPromise;
      } catch (error) {
        const status: TransactionStatus = isTransactionStatus(error) ? error : { kind: 'FailedBeforeSending', errors: [JSON.stringify(error)] } as TransactionStatus;
        return wrapNoErrors({ status });
      }

      if (sentTx.isLocal) {
        throw new Error('isLocal should be false in external executor');
      }

      if ('hash' in sentTx) {
        // We have a valid transaction hash; await chain inclusion
        try {
          if (config?.printTx) {
            console.log(`${tx.getId()} - Awaiting inclusion ...`);
          }
          tx.setStatuses(
            'unchanged' as const,
            TxLifecycleStatus.AWAITING_INCLUSION
          );
          const { resolution: inclusionStatus, resolutionBlockHeight } = await this.awaitTx(
            sentTx.hash,
            config.inclusionAwaitingTimeoutMs
          );

          if (inclusionStatus === 'Included') {
            tx.setStatuses('Included', TxLifecycleStatus.SUCCESS);
            return wrapNoErrors({ status: 'Included', resolutionBlockHeight });
          } else {
            tx.setStatuses(inclusionStatus, TxLifecycleStatus.FAILED);
            return wrapNoErrors({ status: inclusionStatus, resolutionBlockHeight });
          }
        } catch {
          // If we fail to get a final status, assume it's stuck
          tx.setStatuses('StuckInMempool', TxLifecycleStatus.FAILED);
          return wrapNoErrors({ status: 'StuckInMempool' });
        }
      } else if ('errors' in sentTx) {
        // Rejected on sending
        return wrapNoErrors({
          status: { kind: 'RejectedOnReceive', errors: sentTx.errors },
        });
      } else {
        throw new Error('Unknown transaction shape after sending.');
      }
    }, `Waiting tx: ${tx.getId()}`);

    // Return a structure that allows the caller to await each stage
    return {
      provingPromise,
      sendingPromise,
      waitingPromise,
    };
  }
}
