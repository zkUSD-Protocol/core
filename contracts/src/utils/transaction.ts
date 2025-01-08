import { Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { KeyPair } from '../types';

interface TransactionOptions {
  printTx?: boolean;
  extraSigners?: PrivateKey[];
  fee?: number;
  printAccountUpdates?: boolean;
}

export async function transaction(
  sender: KeyPair,
  callback: () => Promise<void>,
  options: TransactionOptions = {}
) {
  const {
    printTx = false,
    extraSigners = [],
    fee,
    printAccountUpdates = false,
  } = options;

  const tx = await Mina.transaction(
    {
      sender: sender.publicKey,
      ...(fee && { fee }),
    },
    callback
  );

  if (printTx) {
    console.log(tx.toPretty());
  }

  if (printAccountUpdates) {
    const auCount: { publicKey: PublicKey; tokenId: Field; count: number }[] =
      [];
    let proofAuthorizationCount = 0;
    for (const au of tx.transaction.accountUpdates) {
      const { publicKey, tokenId, authorizationKind } = au.body;
      if (au.authorization.proof) {
        proofAuthorizationCount++;
        if (authorizationKind.isProved.toBoolean() === false)
          console.error('Proof authorization exists but isProved is false');
      } else if (authorizationKind.isProved.toBoolean() === true)
        console.error('isProved is true but no proof authorization');
      const index = auCount.findIndex(
        (item) =>
          item.publicKey.equals(publicKey).toBoolean() &&
          item.tokenId.equals(tokenId).toBoolean()
      );
      if (index === -1) auCount.push({ publicKey, tokenId, count: 1 });
      else auCount[index].count++;
    }
    console.log(
      `Account updates for tx: ${auCount.length}, proof authorizations: ${proofAuthorizationCount}`
    );
    for (const au of auCount) {
      if (au.count > 1) {
        console.log(
          `DUPLICATE AU: ${au.publicKey.toBase58()} tokenId: ${au.tokenId.toString()} count: ${
            au.count
          }`
        );
      }
    }
    console.log(tx.transaction.accountUpdates);
  }

  await tx.prove();
  tx.sign([sender.privateKey, ...extraSigners]);
  const sentTx = await tx.send();
  const txResult = await sentTx.wait();
  if (txResult.status !== 'included') {
    console.log('Transaction failed with status', txResult.toPretty());
    throw new Error(`Transaction failed with status ${txResult.status}`);
  }

  return txResult;
}
