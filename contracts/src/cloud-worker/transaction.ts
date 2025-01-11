import { Field, PublicKey, Transaction, Mina, UInt64 } from 'o1js';

export function transactionParams(
  serializedTransaction: string,
  signedJson: any
): {
  fee: UInt64;
  sender: PublicKey;
  nonce: number;
  memo: string;
} {
  const { sender, nonce, tx } = JSON.parse(serializedTransaction);
  const transaction = Mina.Transaction.fromJSON(JSON.parse(tx));
  console.log('transaction', transaction);
  const memo = transaction.transaction.memo;
  return {
    fee: UInt64.from(signedJson.zkappCommand.feePayer.body.fee),
    sender: PublicKey.fromBase58(sender),
    nonce: Number(signedJson.zkappCommand.feePayer.body.nonce),
    memo,
  };
}

export function deserializeTransaction(
  serializedTransaction: string,
  txNew: Mina.Transaction<false, false>,
  signedJson: any
) {
  //console.log("new transaction", txNew);
  const { tx, blindingValues, length } = JSON.parse(serializedTransaction);
  const transaction = Mina.Transaction.fromJSON(JSON.parse(tx));
  //console.log("transaction", transaction);
  if (length !== txNew.transaction.accountUpdates.length) {
    throw new Error('New Transaction length mismatch');
  }
  if (length !== transaction.transaction.accountUpdates.length) {
    throw new Error('Serialized Transaction length mismatch');
  }
  for (let i = 0; i < length; i++) {
    transaction.transaction.accountUpdates[i].lazyAuthorization =
      txNew.transaction.accountUpdates[i].lazyAuthorization;
    if (blindingValues[i] !== '')
      (
        transaction.transaction.accountUpdates[i].lazyAuthorization as any
      ).blindingValue = Field.fromJSON(blindingValues[i]);
  }
  transaction.transaction.feePayer.authorization =
    signedJson.zkappCommand.feePayer.authorization;
  transaction.transaction.feePayer.body.fee = UInt64.from(
    signedJson.zkappCommand.feePayer.body.fee
  );
  for (let i = 0; i < length; i++) {
    const signature =
      signedJson.zkappCommand.accountUpdates[i].authorization.signature;
    if (signature !== undefined && signature !== null) {
      transaction.transaction.accountUpdates[i].authorization.signature =
        signedJson.zkappCommand.accountUpdates[i].authorization.signature;
    }
  }
  return transaction;
}

export function serializeTransaction(
  tx: Mina.Transaction<false, false>
): string {
  const length = tx.transaction.accountUpdates.length;
  let i;
  let blindingValues = [];
  for (i = 0; i < length; i++) {
    const la = tx.transaction.accountUpdates[i].lazyAuthorization;
    if (
      la !== undefined &&
      (la as any).blindingValue !== undefined &&
      la.kind === 'lazy-proof'
    )
      blindingValues.push(la.blindingValue.toJSON());
    else blindingValues.push('');
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
