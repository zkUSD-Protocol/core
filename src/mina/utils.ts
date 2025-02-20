import { Field, PublicKey, TokenId, Transaction } from 'o1js';
import {
  MinaZkappCommand,
  SignerZkappCommand,
} from '../o1js-compat/zkappcommand.js';
import { KeyPair } from '../types/utility.js';

export { Account, extractAllTxParties, extractAllTxPartiesJson, isKeyPair, printTxAccountUpdates };

type Account = { publicKey: PublicKey; tokenId?: Field };

// make a type guard against that union
function isKeyPair(x: KeyPair | PublicKey): x is KeyPair {
  return 'publicKey' in x;
}

/** Extracts all parties involved in a tx that may require a local state updated. */
function extractAllTxParties(zkAppCommand: MinaZkappCommand): Set<Account> {
  const parties = new Set<Account>();
  // Function implementation here
  parties.add({ publicKey: zkAppCommand.feePayer.body.publicKey });
  for (let au of zkAppCommand.accountUpdates) {
    parties.add({ publicKey: au.body.publicKey, tokenId: au.body.tokenId });
    const mdelegate = au.body.update.delegate;
    if (mdelegate.isSome) {
      parties.add({ publicKey: mdelegate.value });
    }
  }
  return parties;
}

/** Extracts all parties involved in a tx that may require a local state updated. */
function extractAllTxPartiesJson(
  zkAppCommand: SignerZkappCommand
): Set<Account> {
  const parties = new Set<Account>();
  let tx = zkAppCommand.zkappCommand;

  if (zkAppCommand.feePayer) {
    parties.add({
      publicKey: PublicKey.fromBase58(zkAppCommand.feePayer.feePayer),
    });
  } else {
    parties.add({
      publicKey: PublicKey.fromBase58(tx.feePayer.body.publicKey),
    });
  }
  for (let au of tx.accountUpdates) {
    parties.add({
      publicKey: PublicKey.fromBase58(au.body.publicKey),
      tokenId: TokenId.fromBase58(au.body.tokenId),
    });
    const mdelegate = au.body.update.delegate;
    if (mdelegate) {
      parties.add({ publicKey: PublicKey.fromBase58(mdelegate) });
    }
  }
  return parties;
}

function printTxAccountUpdates(tx: Transaction<false,false>){
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
