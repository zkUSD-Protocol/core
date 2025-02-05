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

// const mgr = this;
// const mkSigningPromise = <T extends boolean>(
//   fee: UInt64,
//   unsignedTx: Transaction<T, false>
// ) => {
//   return new TrackedPromise(async () => {
//     let nonceLock: NonceLock | undefined;
//     try {
//       try {
//         nonceLock = await mgr.mina.nonceManager.getAccountNonce(
//           sender.publicKey
//         );
//       } catch (error) {
//         const err = `Error during getting the tx nonce: ${error}`;
//         console.error(err);
//         throw err;
//       }
//       unsignedTx.transaction.feePayer.body.nonce = nonceLock.nonce;
//       unsignedTx.transaction.feePayer.body.fee = fee;
//       if (options?.printTx) {
//         console.log(
//           `${tx.getId()} - Signing transaction: {nonce: ${
//             nonceLock.nonce
//           }, fee: ${fee}} ...`
//         );
//       }

//       if(this.mina.network.chainId === 'local') {
//         throw "Temporary disabled for local network."
//       }

//       // TODO use signing service instead, do not pass private keys around
//       // not sure how to procees with mina-signer and multiple signers
//       // so lets try this:
//       let signedTx: Transaction<any,true> = unsignedTx;
//       if(options?.extraSigners && options.extraSigners.length > 0) {
//         signedTx = (signedTx as Transaction <any,false>).sign(options.extraSigners);
//       }

//       const signedZkappCommand1 = renameField(JSON.parse(signedTx.toJSON()), 'transaction', 'zkappCommand');
//       const signedZkappCommand = insertField(signedZkappCommand1, 'feePayer', signedZkappCommand1.zkappCommand.feePayer).toJSON();

//       const signedData = new MinaSigner({ network: { custom: this.mina.network.chainId } }).signZkappCommand(signedZkappCommand, sender.privateKey.toBase58());

//       return { signedData, nonceLock };
//     } catch (error) {
//       nonceLock?.unlock();
//       throw failed_before_sending('signing the tx', error);
//     }
//   });
// };
