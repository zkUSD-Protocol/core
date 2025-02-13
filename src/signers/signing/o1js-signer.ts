import { TrackedPromise } from '../../utils/tracked-promise';
import { Signer } from './types';

export { o1jsSigner };

const o1jsSigner: Signer<'O1jsSigner'> = ({ fee, nonce, tx, keys }) => {
  tx.transaction.feePayer.body.nonce = nonce;
  tx.transaction.feePayer.body.fee = fee;
  const signedTx = tx.sign([keys.sender.privateKey, ...keys.extraSigners]);
  return new TrackedPromise(async () => {
    return { signedTx };
  });
};
