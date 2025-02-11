import { Field, PublicKey, Transaction, UInt64 } from 'o1js';
import { ZkappCommand } from 'o1js/dist/node/mina-signer/src/types';

export { serializeTransaction, deserializeTransaction, getTransactionParams };

/**
 * Serializes a transaction to a string.
 */
function serializeTransaction(tx: Transaction<any, any>): string {
  const length = tx.transaction.accountUpdates.length;
  let blindingValues: string[] = [];

  for (let i = 0; i < length; i++) {
    const accountUpdate = tx.transaction.accountUpdates[i];
    const la = accountUpdate.lazyAuthorization;
    if (
      la !== undefined &&
      (la as any).blindingValue !== undefined &&
      la.kind === 'lazy-proof'
    ) {
      const blindingJSON = la.blindingValue.toJSON();
      blindingValues.push(blindingJSON);
    } else {
      blindingValues.push('');
    }
  }

  const serializedTransaction = JSON.stringify(
    {
      tx: tx.toJSON(),
      blindingValues,
      length,
      fee: tx.transaction.feePayer.body.fee.toJSON(),
      sender: tx.transaction.feePayer.body.publicKey.toBase58(),
      nonce: tx.transaction.feePayer.body.nonce.toBigint().toString(),
    },
    null,
    2
  );
  return serializedTransaction;
}

/**
 * Deserializes a transaction from serialized data.
 */
function deserializeTransaction(
  serializedTransaction: string,
  txNew: Transaction<false, false>,
  signedJson: ZkappCommand
) {
  let parsedData;
  try {
    parsedData = JSON.parse(serializedTransaction);
  } catch (err) {
    throw err;
  }

  const { tx, blindingValues, length } = parsedData;
  let transactionJson;
  try {
    transactionJson = JSON.parse(tx);
  } catch (err) {
    throw err;
  }

  const transaction = Transaction.fromJSON(transactionJson);

  // Check length consistency
  if (length !== txNew.transaction.accountUpdates.length) {
    throw new Error('New Transaction length mismatch');
  }
  if (length !== transaction.transaction.accountUpdates.length) {
    throw new Error('Serialized Transaction length mismatch');
  }

  // Merge lazyAuthorizations and blinding values from txNew and serialized data
  for (let i = 0; i < length; i++) {
    transaction.transaction.accountUpdates[i].lazyAuthorization =
      txNew.transaction.accountUpdates[i].lazyAuthorization;
    if (blindingValues[i] !== '') {
      (
        transaction.transaction.accountUpdates[i].lazyAuthorization as any
      ).blindingValue = Field.fromJSON(blindingValues[i]);
    } else {
    }
  }

  // Update fee payer's authorization and fee
  transaction.transaction.feePayer.authorization =
    signedJson.zkappCommand.feePayer.authorization;
  transaction.transaction.feePayer.body.fee = UInt64.from(
    signedJson.zkappCommand.feePayer.body.fee
  );

  // Set signatures for account updates, if available
  for (let i = 0; i < length; i++) {
    const signature =
      signedJson.zkappCommand.accountUpdates[i].authorization.signature;
    if (signature !== undefined && signature !== null) {
      transaction.transaction.accountUpdates[i].authorization.signature =
        signature;
    } else {
    }
  }

  return transaction;
}

/**
 * Extracts basic transaction parameters from serialized transaction data.
 */
function getTransactionParams(
  serializedTransaction: string,
  signedJson: any
): {
  fee: UInt64;
  sender: PublicKey;
  nonce: number;
  memo: string;
} {
  let parsedData;
  try {
    parsedData = JSON.parse(serializedTransaction);
  } catch (err) {
    console.error(
      'getTransactionParams: Failed to parse serializedTransaction',
      err
    );
    throw err;
  }

  const { sender, tx } = parsedData;
  let transactionJson;
  try {
    transactionJson = JSON.parse(tx);
  } catch (err) {
    console.error(
      'getTransactionParams: Failed to parse transaction JSON',
      err
    );
    throw err;
  }

  const transaction = Transaction.fromJSON(transactionJson);
  const memo = transaction.transaction.memo;

  const fee = UInt64.from(signedJson.zkappCommand.feePayer.body.fee);
  const publicKey = PublicKey.fromBase58(sender);
  const nonce = Number(signedJson.zkappCommand.feePayer.body.nonce);

  return {
    fee,
    sender: publicKey,
    nonce,
    memo,
  };
}
