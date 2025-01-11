import { Mina, PublicKey } from "o1js";
import { fee } from "zkcloudworker";

export const transaction = async (
  callback: () => Promise<void>,
  memo: string
) => {
  console.log("Preparing transaction with callback");

  if (!Mina) {
    throw new Error("Mina not found");
  }

  const calculatedFee = await fee();

  console.log("Calculated fee", calculatedFee);

  const tx = await Mina.transaction(
    {
      sender: PublicKey.fromBase58(sender),
      fee: calculatedFee ?? 1e8,
      memo,
    },
    async () => {
      await callback();
    }
  );

  console.log("Transaction prepared", tx);

  return { tx, fee: calculatedFee };
};

export const serializeTransaction = (tx: Mina.Transaction<false, false>) => {
  const length = tx.transaction.accountUpdates.length;
  let i;
  let blindingValues = [];
  for (i = 0; i < length; i++) {
    const la = tx.transaction.accountUpdates[i].lazyAuthorization;
    if (
      la !== undefined &&
      //@ts-ignore
      la.blindingValue !== undefined &&
      la.kind === "lazy-proof"
    )
      blindingValues.push(la.blindingValue.toJSON());
    else blindingValues.push("");
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
};
