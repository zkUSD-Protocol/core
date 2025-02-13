import { PrivateKey, Transaction, UInt32, UInt64 } from 'o1js';
import { Signer } from './types.js';
import { Client as MinaSigner } from 'mina-signer';
import { ZkappCommand } from 'o1js/dist/node/mina-signer/src/types';
import { KeyPair } from '../types/utility.js';
import { TrackedPromise } from '../utils/tracked-promise.js';

export { testnetMinaSigner };

type FeePayer = {
  readonly feePayer: string;
  readonly fee: string;
  readonly nonce: string;
  readonly memo?: string;
  readonly validUntil?: string;
};

const testnetMinaSigner: Signer<'MinaSigner'> = <P extends boolean>(args: {
  fee: UInt64;
  nonce: UInt32;
  tx: Transaction<P, false>;
  keys: {
    sender: KeyPair;
    extraSigners: PrivateKey[];
  };
}) => {
  const { keys, fee, nonce, tx } = args;

  tx.transaction.feePayer.body.nonce = nonce;
  tx.transaction.feePayer.body.fee = fee;

  let signedTx: Transaction<any, true> = tx;
  if (keys.extraSigners.length > 0) {
    signedTx = (signedTx as Transaction<any, false>).sign(keys.extraSigners);
  }

  const zkappCommand = JSON.parse(signedTx.toJSON());

  const feePayer: FeePayer = {
    feePayer: tx.transaction.feePayer.body.publicKey.toBase58(),
    fee: fee.toString(),
    nonce: nonce.toString(),
    memo: tx.transaction.memo,
    ...(tx.transaction.feePayer.body.validUntil
      ? { validUntil: tx.transaction.feePayer.body.validUntil.toString() }
      : {}),
  };

  const minaSignerTx: ZkappCommand = {
    zkappCommand,
    feePayer,
  };

  const signedData = new MinaSigner({ network: 'testnet' }).signZkappCommand(
    minaSignerTx,
    keys.sender.privateKey.toBase58()
  );
  return new TrackedPromise(async () => {
    return { signedTx: signedData };
  });
};
