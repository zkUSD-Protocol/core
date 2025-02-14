import { Transaction, UInt64 } from 'o1js';
import { TrackedPromise } from '../utils/tracked-promise.js';
import {
  ITransactionExecutor,
  PreparedTransaction,
  TransactionExecutionConfig,
  TransactionLifecycle,
} from './executor.js';
import {
  TransactionStatus,
  TxLifecycleStatus,
  mkStatusFailedBeforeSending,
  statusIsRejectedTransaction,
} from './status.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import { Mutex } from '../utils/mutex.js';
import { o1jsSigner } from '../signers/o1js-signer.js';
import { KeyPair } from '../types/utility.js';
import { isKeyPair } from '../mina/utils.js';

export class LocalTransactionExecutor implements ITransactionExecutor {
  public get signer() {
    return o1jsSigner;
  }

  executeTransaction(
    tx: PreparedTransaction,
    config: TransactionExecutionConfig,
    _options?: unknown
  ): Promise<TransactionLifecycle> {
    if (!isKeyPair(tx.keys.sender)) {
      throw new Error(
        'LocalTransactionExecutor requires the sender to be a KeyPair'
      );
    }
    const sender = tx.keys.sender as KeyPair;
    const self = this;
    // const failed_before_sending = (phase: string, error: unknown) =>
    const failed_before_sending = (phase: string, error: unknown) => {
      return mkStatusFailedBeforeSending(tx.getId(), phase, error);
    };

    const mkState = <T>(transaction: T) => {
      return { isLocal: true as true, transaction };
    };

    // schedule proving
    const provingPromise = new TrackedPromise(async () => {
      let builtTx;
      try {
        builtTx = await tx.buildTx;
      } catch (error) {
        const errorMessage = JSON.stringify(error);
        throw failed_before_sending('Building the tx', errorMessage);
      }
      try {
        if (config?.printTx) {
          console.log(`${tx.getId()} - Proving transaction ...`);
        }
        tx.setStatuses('unchanged' as const, TxLifecycleStatus.PROVING);
        return mkState(
          await transactionProve(builtTx, config.mina, config.o1jsMutex)
        );
      } catch (error) {
        throw failed_before_sending('proving the tx', error);
      }
    });

    // create sending promise maker
    const mkSendingPromise = function (fee: UInt64) {
      return new TrackedPromise(async () => {
        const results = await provingPromise;
        const transaction = results.transaction;

        // TODO don't we need token as well?
        let nonceLock = await tx.nonceLock(sender.publicKey);
        // send the transaction
        try {
          tx.setStatuses('unchanged' as const, TxLifecycleStatus.SIGNING);
          const { signedTx } = await self.signer({
            keys: { sender, extraSigners: tx.keys.extraSigners },
            nonce: nonceLock.nonce,
            fee,
            tx: transaction,
          });
          tx.setStatuses('unchanged' as const, TxLifecycleStatus.SCHEDULED);

          if (config?.printTx) {
            console.log(`${tx.getId()} - Sending transaction ...`);
            console.log('Pretty printing signed tx', signedTx.toPretty());
          }

          const sentTx = await signedTx.safeSend();
          // unlock the nonce after sending
          await nonceLock.unlock();
          switch (sentTx.status) {
            case 'pending': {
              tx.setStatuses('Pending', TxLifecycleStatus.PENDING);
              break;
            }
            case 'rejected': {
              tx.setStatuses(
                {
                  kind: 'RejectedOnReceive',
                  errors: ['error when the tx has been sent', ...sentTx.errors],
                },
                TxLifecycleStatus.FAILED
              );
              break;
            }
          }
          return mkState(sentTx);
        } catch (error) {
          await nonceLock?.unlock();
          throw failed_before_sending('sending the tx', error);
        }
      });
    };
    // schedule sending
    const sendingPromise = mkSendingPromise(config.startingFee);

    // schedule waiting for the transaction to be included
    const waitingPromise = new TrackedPromise(async () => {
      try {
        const { transaction: sentTx } = await sendingPromise;
        if (statusIsRejectedTransaction(sentTx)) return mkState(sentTx);
        if (config?.printTx) {
          console.log(`${tx.getId()} - Awaiting inclusion ...`);
        }
        tx.setStatuses(
          'unchanged' as const,
          TxLifecycleStatus.AWAITING_INCLUSION
        );
        const awaitedTx = await sentTx.safeWait();
        if (awaitedTx.status === 'included') {
          tx.setStatuses('Included', TxLifecycleStatus.SUCCESS);
          // make sure that the local state matches the state after tx
          await config.mina.forceFetchAllTxParties(awaitedTx);
        } else {
          // TODO check if actually rejected or stuck in mempool
          // if stuck then retry with higher fee
          console.log('TODO - rejected or stuck in mempool');
          const actualStatus = 'rejected';

          if (actualStatus === 'rejected') {
            tx.setStatuses(
              {
                kind: 'RejectedOnInclusion',
                errors: [
                  'error during awaiting for inclusion',
                  ...awaitedTx.errors,
                ],
              },
              TxLifecycleStatus.FAILED
            );
          }
        }
        return mkState(awaitedTx);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'kind' in error) {
          const status = error as TransactionStatus;
          tx.setStatuses(status, TxLifecycleStatus.FAILED);
        }
        return mkState(undefined);
      }
    });

    return Promise.resolve({
      provingPromise,
      sendingPromise,
      waitingPromise,
    });
  }
}

export async function transactionProve<T extends boolean>(
  tx: Transaction<false, T>,
  mina: IMinaNetworkInterface,
  mutex: Mutex
): Promise<Transaction<true, T>> {
  try {
    await mina.forceFetchAllTxParties(tx);
    return await mutex.runExclusive(async () => await tx.prove());
  } catch (error) {
    console.error('Error during transaction proving:', error);
    throw error; // Propagate the error to the caller
  }
}
