import { Field, PublicKey } from 'o1js';
import { ZkappCommand } from 'o1js/dist/node/lib/mina/account-update';

export { extractAllTxParties };

type Account = { publicKey: PublicKey; tokenId?: Field };

/** Extracts all parties involved in a tx that may require a local state updated. */
function extractAllTxParties(zkAppCommand: ZkappCommand): Set<Account> {
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

// // a function that will ensure string is a valid AuthRequired
// function assertAuthRequired(value: string): AuthRequired {
//   if (value === 'Signature' || value === 'Proof' || value === 'Either' || value === 'None' || value === 'Impossible') {
//     return value;
//   }
//   throw new Error('Invalid AuthRequired');
// }

// // a function that will ensure string is a valid Sign
// function assertSign(value: string): Sign {
//   if (value === 'Positive' || value === 'Negative') {
//     return value;
//   }
//   throw new Error('Invalid Sign');
// }

// const parsers = {
//   PublicKey: (value: string) => PublicKey.fromJSON(value),
//   UInt64: (value: string) => UInt64.fromJSON(value),
//   UInt32: (value: string) => UInt32.fromJSON(value),
//   TokenId: (value: string) => Field.fromJSON(value),
//   Field: (value: string) => Field.fromJSON(value),
//   AuthRequired: (value: string) => assertAuthRequired(value),
//   Bool: (value: boolean) => Bool.fromJSON(value),
//   Sign: (value: string) => assertSign(value),
// };
// function parseZkappCommand_(jsonString: string, parsers: {
//   PublicKey: (value: string) => PublicKey;
//   UInt64: (value: string) => UInt64;
//   UInt32: (value: string) => UInt32;
//   TokenId: (value: string) => Field;
//   Field: (value: string) => Field;
//   AuthRequired: (value: string) => AuthRequired;
//   Bool: (value: boolean) => Bool;
//   Sign: (value: string) => Sign;
// }): any {
//   const data = JSON.parse(jsonString);

//   function parseAccountUpdate(update: any) {
//     return {
//       body: {
//         publicKey: parsers.PublicKey(update.body.publicKey),
//         tokenId: parsers.TokenId(update.body.tokenId),
//         update: {
//           appState: update.body.update.appState.map((val: any) => val !== null ? parsers.Field(val) : null),
//           delegate: update.body.update.delegate ? parsers.PublicKey(update.body.update.delegate) : null,
//           verificationKey: update.body.update.verificationKey ? {
//             data: update.body.update.verificationKey.data,
//             hash: parsers.Field(update.body.update.verificationKey.hash)
//           } : null,
//           permissions: update.body.update.permissions ? {
//             editState: parsers.AuthRequired(update.body.update.permissions.editState),
//             access: parsers.AuthRequired(update.body.update.permissions.access),
//             send: parsers.AuthRequired(update.body.update.permissions.send),
//             receive: parsers.AuthRequired(update.body.update.permissions.receive),
//             setDelegate: parsers.AuthRequired(update.body.update.permissions.setDelegate),
//             setPermissions: parsers.AuthRequired(update.body.update.permissions.setPermissions),
//             setVerificationKey: {
//               auth: parsers.AuthRequired(update.body.update.permissions.setVerificationKey.auth),
//               txnVersion: parsers.UInt32(update.body.update.permissions.setVerificationKey.txnVersion)
//             },
//             setZkappUri: parsers.AuthRequired(update.body.update.permissions.setZkappUri),
//             editActionState: parsers.AuthRequired(update.body.update.permissions.editActionState),
//             setTokenSymbol: parsers.AuthRequired(update.body.update.permissions.setTokenSymbol),
//             incrementNonce: parsers.AuthRequired(update.body.update.permissions.incrementNonce),
//             setVotingFor: parsers.AuthRequired(update.body.update.permissions.setVotingFor),
//             setTiming: parsers.AuthRequired(update.body.update.permissions.setTiming)
//           } : null,
//           zkappUri: update.body.update.zkappUri || null,
//           tokenSymbol: update.body.update.tokenSymbol || null,
//           timing: update.body.update.timing ? {
//             initialMinimumBalance: parsers.UInt64(update.body.update.timing.initialMinimumBalance),
//             cliffTime: parsers.UInt32(update.body.update.timing.cliffTime),
//             cliffAmount: parsers.UInt64(update.body.update.timing.cliffAmount),
//             vestingPeriod: parsers.UInt32(update.body.update.timing.vestingPeriod),
//             vestingIncrement: parsers.UInt64(update.body.update.timing.vestingIncrement)
//           } : null,
//           votingFor: update.body.update.votingFor ? parsers.Field(update.body.update.votingFor) : null
//         },
//         balanceChange: {
//           magnitude: parsers.UInt64(update.body.balanceChange.magnitude),
//           sgn: parsers.Sign(update.body.balanceChange.sgn)
//         },
//         incrementNonce: parsers.Bool(update.body.incrementNonce),
//         events: update.body.events.map((event: any) => event.map(parsers.Field)),
//         actions: update.body.actions.map((action: any) => action.map(parsers.Field)),
//         callData: parsers.Field(update.body.callData),
//         callDepth: update.body.callDepth,
//         useFullCommitment: parsers.Bool(update.body.useFullCommitment),
//         implicitAccountCreationFee: parsers.Bool(update.body.implicitAccountCreationFee),
//         mayUseToken: {
//           parentsOwnToken: parsers.Bool(update.body.mayUseToken.parentsOwnToken),
//           inheritFromParent: parsers.Bool(update.body.mayUseToken.inheritFromParent)
//         },
//         authorizationKind: {
//           isSigned: parsers.Bool(update.body.authorizationKind.isSigned),
//           isProved: parsers.Bool(update.body.authorizationKind.isProved),
//           verificationKeyHash: parsers.Field(update.body.authorizationKind.verificationKeyHash)
//         }
//       },
//       authorization: {
//         proof: update.authorization.proof || null,
//         signature: update.authorization.signature || null
//       }
//     };
//   }

//   return {
//     feePayer: {
//       body: {
//         publicKey: parsers.PublicKey(data.feePayer.body.publicKey),
//         fee: parsers.UInt64(data.feePayer.body.fee),
//         validUntil: data.feePayer.body.validUntil !== null ? parsers.UInt32(data.feePayer.body.validUntil) : null,
//         nonce: parsers.UInt32(data.feePayer.body.nonce)
//       },
//       authorization: data.feePayer.authorization
//     },
//     accountUpdates: data.accountUpdates.map(parseAccountUpdate),
//     memo: data.memo
//   };
// }

// export const parseZkappCommand = (jsonString: string) => parseZkappCommand_(jsonString, parsers);

// export async function deserializeTxProof(proofJsonString: string) : Promise<Proof<ZkappPublicInput, Empty>> {
//   return await Proof.fromJSON(JSON.parse(proofJsonString));
// }
