import { Field, PublicKey, TokenId } from 'o1js';
import {
  MinaZkappCommand,
  SignerZkappCommand,
} from '../o1js-compat/zkappcommand.js';
import { KeyPair } from '../types/utility.js';

export { Account, extractAllTxParties, extractAllTxPartiesJson, isKeyPair };

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

  console.log(JSON.stringify(zkAppCommand, null, 2));

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
