import {
  AwaitedTransaction,
  ITransactionExecutor,
  PreparedTransaction,
  ProvenTransaction,
  SentTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from './executor';
import {
  FailedBeforeSending,
  RejectedOnInclusion,
  RejectedOnReceive,
  TransactionStatus,
} from './status';
import { TrackedPromise } from '../utils/tracked-promise';
import { ITransactionProver } from '../provers/itransactionprover';
import { IMinaNetworkInterface } from '../mina/network-interface';
import { testnetMinaSigner } from '../signers/signing/mina-signer';
import {
  deserializeTransaction,
  serializeTransaction,
} from '../utils/transaction-serialization';
import {
  ITransactionStatusScanner,
  TransactionStatusScanner,
} from './status-scanner';

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
  public get signer() {
    return testnetMinaSigner;
  }

  /**
   * Await the final chain status of a transaction by its hash.
   */
  private async awaitTx(
    hash: string,
    timeoutMs: number
  ): Promise<'Included' | RejectedOnInclusion> {
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
    const nonceLock = await tx.nonceLock(tx.keys.sender.publicKey);

    try {
      // Sign and await dependencies in parallel
      const [{ signedTx }] = await Promise.all([
        this.signer({
          fee: config.startingFee,
          nonce: nonceLock.nonce,
          tx: tx.tx,
          keys: tx.keys,
        }),
        tx.depsAwaitingPromise,
      ]);

      const input = {
        txId: tx.getId(),
        transaction: {
          serializedTx: serializeTransaction(tx.tx),
          signedZkappCommand: signedTx,
        },
        ...tx.args,
      };

      // ---- Proving Promise ----
      const provingPromise = new TrackedPromise<ProvenTransaction>(
        async () =>
          await this.prover
            .proveTransaction(input)
            .then(async (txProvingOutput) => {
              if (txProvingOutput.success === false) {
                const status: FailedBeforeSending = {
                  kind: 'FailedBeforeSending',
                  errors: txProvingOutput.errors,
                };
                tx.setStatus(status);
                if (config?.printTx) {
                  console.log(
                    `${tx.getId()} - Proving failed: ${JSON.stringify(status)}`
                  );
                }
                await nonceLock.unlock();
                return wrapError({ status });
              } else {
                if (config?.printTx) {
                  console.log(`${tx.getId()} - Proved.`);
                }
                return wrapNoErrors({
                  serializedProvenTransaction:
                    txProvingOutput.serializedProvenTransaction,
                });
              }
            })
            .catch(async (error) => {
              const errors = Array.isArray(error)
                ? error.map((e) => (e instanceof Error ? e.message : String(e)))
                : error instanceof Error
                ? [error.message]
                : [String(error)];

              const status: FailedBeforeSending = {
                kind: 'FailedBeforeSending',
                errors,
              };
              tx.setStatus(status);
              if (config?.printTx) {
                console.log(
                  `${tx.getId()} - Proving failed: ${JSON.stringify(status)}`
                );
              }
              await nonceLock.unlock();
              return wrapError({ status });
            }),
        `Proving tx: ${tx.getId()}`
      );

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
              tx.tx,
              signedTx.data
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
              tx.setStatus(status);
              return wrapError({ status });
            } else {
              if (config?.printTx) {
                console.log(
                  `${tx.getId()} - Sent successfully. The tx is pending inclusion.`
                );
              }
              tx.setStatus('Pending');
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
          const stringError = error instanceof Error ? error.message : '';
          const status: FailedBeforeSending = {
            kind: 'FailedBeforeSending',
            errors: ['Exceptional failure', stringError],
          };
          tx.setStatus(status);
          throw error;
        }
      }, `Sending tx: ${tx.getId()}`);

      // ---- Waiting Promise (chain inclusion) ----
      const waitingPromise = new TrackedPromise<AwaitedTransaction>(
        async () => {
          const sentTx = await sendingPromise;

          if (sentTx.isLocal) {
            throw new Error('isLocal should be false in external executor');
          }

          if ('hash' in sentTx) {
            // We have a valid transaction hash; await chain inclusion
            try {
              if (config?.printTx) {
                console.log(`${tx.getId()} - Awaiting inclusion ...`);
              }
              const inclusionStatus = await this.awaitTx(
                sentTx.hash,
                config.awaitingTimeoutMs
              );

              if (inclusionStatus === 'Included') {
                tx.setStatus('Included');
                return wrapNoErrors({ status: 'Included' });
              } else {
                tx.setStatus(inclusionStatus);
                return wrapNoErrors({ status: inclusionStatus });
              }
            } catch {
              // If we fail to get a final status, assume it's stuck
              tx.setStatus('StuckInMempool');
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
        },
        `Waiting tx: ${tx.getId()}`
      );

      // Return a structure that allows the caller to await each stage
      return {
        provingPromise,
        sendingPromise,
        waitingPromise,
      };
    } catch (error) {
      await nonceLock.unlock();
      throw error;
    }
  }
}
