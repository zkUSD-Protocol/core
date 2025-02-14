import { Field, PublicKey } from 'o1js';
import { MinaZkappCommand } from '../o1js-compat/zkappcommand.js';
import { KeyPair } from '../types/utility.js';

export { Account, extractAllTxParties, isKeyPair };

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
