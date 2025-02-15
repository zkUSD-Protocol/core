import { PrivateKey, PublicKey, Transaction, UInt32, UInt64 } from 'o1js';
import { Signed } from '../o1js-compat/signed';
import { SignerZkappCommand } from '../o1js-compat/zkappcommand';
import { KeyPair } from '../types/utility';
import { TrackedPromise } from '../utils/tracked-promise';

export { Signer, SignedTxType, TxSignerType, SignedBrowserData };

type TxSignerType = 'O1jsSigner' | 'MinaSigner' | 'AuroWalletSigner';

type SignedBrowserData = {
  signedData: string;
};

type SignedTxType<Proven extends boolean> = {
  ['O1jsSigner']: Transaction<Proven, true>;
  ['MinaSigner']: Signed<SignerZkappCommand>;
  ['AuroWalletSigner']: SignedBrowserData;
};

type SenderType = {
  ['O1jsSigner']: KeyPair;
  ['MinaSigner']: KeyPair;
  ['AuroWalletSigner']: PublicKey;
};

type Signer<T extends TxSignerType> = <P extends boolean>(args: {
  nonce: UInt32;
  fee: UInt64;
  tx: Transaction<P, false>;
  keys: {
    sender: SenderType[T];
    extraSigners: PrivateKey[];
  };
}) => TrackedPromise<{ signedTx: SignedTxType<P>[T] }>;
