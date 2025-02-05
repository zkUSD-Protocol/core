import { PrivateKey, Transaction, UInt32, UInt64 } from 'o1js';
import { Signed, ZkappCommand } from 'o1js/dist/node/mina-signer/src/types';
import { TrackedPromise } from '../../utils/tracked-promise';
import { KeyPair } from '../../types/utility';

export { Signer, SignedTxType, TxSignerType };

type TxSignerType = 'O1jsSigner' | 'MinaSigner';

type SignedTxType<Proven extends boolean> = {
  ['O1jsSigner']: Transaction<Proven, true>;
  ['MinaSigner']: Signed<ZkappCommand>;
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
