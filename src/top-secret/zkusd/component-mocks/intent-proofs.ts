import { Field, PrivateKey, Signature, UInt64, UInt8 } from "o1js";
import { FullState } from "../validator/block-state.js";
import { CreateVaultIntentKey } from "../programs/intents/create-vault.js";
import { CreateVaultIntent, CreateVaultIntentInput, CreateVaultPrivateInput, CreateVaultIntentProof } from "../programs/intents/create-vault.js";
import { KeyPair } from "../../../types/utility.js";
import { IntentProof } from "../types/intent-proof.js";
import { IntentProofStore } from "./intent-proof-store.js";
import { DepositIntent, DepositIntentInput, DepositIntentKey, DepositIntentProof, DepositPrivateInput } from "../programs/intents/deposit.js";

type KeyPairAlias = number | string;

interface KeyPairs {
  user(keyPairAlias: KeyPairAlias) : KeyPair
}

export class KeyPairsImpl implements KeyPairs{

  private readonly _keypairs: Map<KeyPairAlias, KeyPair> = new Map();

  constructor(){
  }

  user(keyPairAlias: KeyPairAlias) : KeyPair{
    let keyPair = this._keypairs.get(keyPairAlias);
    if (!keyPair) {
      keyPair = PrivateKey.randomKeypair();
      this._keypairs.set(keyPairAlias, keyPair);
    }
    return keyPair;
  }
}

export class IntentProofProvider{

  readonly keypairs: KeyPairs;
  readonly intentProofStore: IntentProofStore | undefined;

  constructor(args?:{keypairs?: KeyPairs, intentProofStore?: IntentProofStore}){
    this.keypairs = args?.keypairs ?? new KeyPairsImpl();
    this.intentProofStore = args?.intentProofStore;
  }

  // |  BurnIntentProof }
  // |  MintIntentProof }
  // |  TransferIntentProof }
  // |  RedeemIntentProof }
  // |  CreateVaultIntentProof }
  // |  DepositIntentProof }
  // |  LiquidateIntentProof };
  
/* export class DepositIntentInput extends Struct({
  vaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class VaultKey extends Struct({
  key: Field,
}) {}

export class DepositIntentOutput extends Struct({
  vaultKey: VaultKey,
  vaultPack: Field,
}) {}

export class DepositPrivateInput extends Struct({
  vaultMap: VaultMap,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}
 */

  async depositIntent(state: FullState, userAlias: KeyPairAlias, amount: UInt64 ) {
    // prepare public input
    const vaultMap = state.vaultMap;
    const publicInput = new DepositIntentInput({
        vaultMapRoot: vaultMap.root,
        collateralRatio: state.systemParams.collateralRatio,
        liquidationBonusRatio: state.systemParams.liquidationBonusRatio,
    });
    // prepare private input
    const type = UInt8.from(0);
    const message: Field[] = [
      vaultMap.root,
      type.value,
      DepositIntentKey,
    ];
    const signature = Signature.create(this.keypairs.user(userAlias).privateKey, message);
    const privateInput = new DepositPrivateInput({
        vaultMap,
        type,
        ownerSignature: signature,
        ownerPublicKey: this.keypairs.user(userAlias).publicKey,
        amount,
    });

    const output = await DepositIntent.rawMethods.deposit(publicInput, privateInput);

    const dummyProof = await DepositIntentProof.dummy(
        publicInput,
        output.publicOutput,
        0,
    );

    const intentProof: IntentProof = {
        kind: 'deposit',
        proof: dummyProof,
    };

    if(this.intentProofStore){
        this.intentProofStore.storeProof(intentProof);
    }

    return intentProof;

  }

// export class TransferIntentInput extends Struct({
//   intentZkUsdMapRoot: Field,
// }) {}

// export class TransferIntentOutput extends Struct({
//   nullifiers: Nullifiers,
//   outputNoteCommitments: OutputNoteCommitments,
// }) {}

// export class TransferIntentPrivateInput extends Struct({
//   intentZkUsdMap: ZkUsdMap,
//   inputNotes: InputNotes,
//   outputNotes: OutputNotes,
//   spendingSignature: Signature,
//   spendingPublicKey: PublicKey,
// }) {}


  // async createTransferNotes(args:{state: FullState, amount: UInt64, toPublicKey: PublicKey}){

    
  //   const {state, amount, toPublicKey} = args;
  //   const inputNotes = InputNotes.empty();
  //   const outputNotes = OutputNotes.empty();
  //   outputNotes.notes[0] = OutputNote.create({
  //     amount,
  //     address: toPublicKey,
  //   });
  //   return {inputNotes, outputNotes};
  // }


  // async addTransferIntent(args:{userAlias: KeyPairAlias, state: FullState, amount: UInt64, toPublicKey: PublicKey}){
  //   const {userAlias, state, amount, toPublicKey} = args;
  //   // create public input
  //   const intentZkUsdMap = state.zkUsdMap;
  //   const publicInput = new TransferIntentInput({
  //       intentZkUsdMapRoot: intentZkUsdMap.root,
  //   });
  //   // create private input
  //   const type = UInt8.from(0);
  //   // the message is input notes hash

  //   const signature = Signature.create(this.keypairs.user(userAlias).privateKey, message);
  //   const privateInput = new TransferIntentPrivateInput({
  //       intentZkUsdMap,
  //       inputNotes: InputNotes.empty(),
  //       outputNotes: OutputNotes.empty(),
  //       spendingSignature: signature,
  //       spendingPublicKey: this.keypairs.user(userAlias).publicKey,
  //   });
    
  // }
    
  

    // // for each of the proof types above define
    async createVaultIntent(userAlias: KeyPairAlias, state: FullState): Promise<IntentProof> {

        const vaultMap = state.vaultMap;

        const type = UInt8.from(0);
        const message: Field[] = [
          vaultMap.root,
          type.value,
          CreateVaultIntentKey,
        ];

        const signature = Signature.create(this.keypairs.user(userAlias).privateKey, message);

        const publicInput = new CreateVaultIntentInput({
            vaultMapRoot: vaultMap.root,
        });

        const privateInput = new CreateVaultPrivateInput({
            vaultMap,
            type,
            ownerSignature: signature,
            ownerPublicKey: this.keypairs.user(userAlias).publicKey,
        });

        const output = await CreateVaultIntent.rawMethods.createVault(publicInput, privateInput);

        const dummyProof = await CreateVaultIntentProof.dummy(
            publicInput,
            output.publicOutput,
            0,
        );

        const intentProof: IntentProof = {
            kind: 'create-vault',
            proof: dummyProof,
        };

        if(this.intentProofStore){
            this.intentProofStore.storeProof(intentProof);
        }

        return intentProof;
    }

}
