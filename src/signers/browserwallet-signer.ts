import { PrivateKey, PublicKey, Transaction, UInt32, UInt64 } from 'o1js';
import { SignedBrowserData, Signer } from './types.js';
import { ZkappCommand } from 'o1js/dist/node/mina-signer/src/types';
import { TrackedPromise } from '../utils/tracked-promise.js';
import { Signed } from '../o1js-compat/signed.js';

export { browserWalletSigner };

type FeePayer = {
  readonly feePayer: string;
  readonly fee: string;
  readonly nonce: string;
  readonly memo?: string;
  readonly validUntil?: string;
};

const browserWalletSigner: Signer<'AuroWalletSigner'> = <
  P extends boolean,
>(args: {
  fee: UInt64;
  nonce: UInt32;
  tx: Transaction<P, false>;
  keys: {
    sender: PublicKey;
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
  const feePayer: FeePayer = {
    feePayer: tx.transaction.feePayer.body.publicKey.toBase58(),
    fee: fee.toString(),
    nonce: nonce.toString(),
    memo: tx.transaction.memo,
    ...(tx.transaction.feePayer.body.validUntil
      ? { validUntil: tx.transaction.feePayer.body.validUntil.toString() }
      : {}),
  };

  return new TrackedPromise(async () => {
    const signedData = await browserSign(signedTx, feePayer);
    return { signedTx: signedData };
  });
};

async function browserSign<T extends boolean>(
  tx: Transaction<T, any>,
  feePayer: FeePayer
): Promise<SignedBrowserData> {
  if (!window) {
    throw new Error(
      'Browser wallet signer can only be used in a browser environment'
    );
  }
  if (!(window as any).mina) {
    throw new Error('Mina wallet browser extension not found.');
  }
  const wallet = (window as any).mina;

  const signResult = await wallet.sendTransaction({
    onlySign: true,
    transaction: tx.toJSON(),
    feePayer,
  });

  if (!signResult || 'code' in signResult) {
    throw new Error(signResult?.message || 'Signing failed');
  }

  if (!('signedData' in signResult)) {
    throw new Error('Expected signed zkApp command');
  }
  return signResult;
}
