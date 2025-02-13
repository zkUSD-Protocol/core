import { PrivateKey, Transaction, UInt32, UInt64 } from 'o1js';
import { TrackedPromise } from '../../utils/tracked-promise.js';
import { KeyPair } from '../../types/utility.js';
import { SignerZkappCommand } from '../../o1js-compat/zkappcommand.js';
import { Signed } from '../../o1js-compat/signed.js';

export { Signer, SignedTxType, TxSignerType };

type TxSignerType = 'O1jsSigner' | 'MinaSigner';

type SignedTxType<Proven extends boolean> = {
  ['O1jsSigner']: Transaction<Proven, true>;
  ['MinaSigner']: Signed<SignerZkappCommand>;
};

type Signer<T extends TxSignerType> = <P extends boolean>(args: {
  nonce: UInt32;
  fee: UInt64;
  tx: Transaction<P, false>;
  keys: {
    sender: KeyPair;
    extraSigners: PrivateKey[];
  };
}) => TrackedPromise<{ signedTx: SignedTxType<P>[T] }>;
