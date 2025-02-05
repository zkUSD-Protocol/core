import { Transaction } from 'o1js';
import { TrackedPromise } from '../../utils/tracked-promise';
import { Signer } from './types';
import { insertField, renameField } from '../../types/utility';
import { Client as MinaSigner } from 'mina-signer';

export { minaSigner };

//  provisional implementation to much expected zkcloudworker transaction data
// TODO refactor later.
const minaSigner: Signer<'MinaSigner'> = ({ fee, nonce, tx, keys }) => {
  tx.transaction.feePayer.body.nonce = nonce;
  tx.transaction.feePayer.body.fee = fee;

  let signedTx: Transaction<any, true> = tx;
  if (keys.extraSigners.length > 0) {
    signedTx = (signedTx as Transaction<any, false>).sign(keys.extraSigners);
  }

  const signedZkappCommand1 = renameField(
    JSON.parse(signedTx.toJSON()),
    'transaction',
    'zkappCommand'
  );
  const signedZkappCommand = insertField(
    signedZkappCommand1,
    'feePayer',
    signedZkappCommand1.zkappCommand.feePayer
  ).toJSON();

  const signedData = new MinaSigner({ network: 'testnet' }).signZkappCommand(
    signedZkappCommand,
    keys.sender.privateKey.toBase58()
  );
  return new TrackedPromise(async () => {
    return { signedTx: signedData };
  });
};
