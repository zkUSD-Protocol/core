import { Field, PrivateKey, Signature, UInt8 } from "o1js";
import { FullState } from "../validator/block-state";
import { CreateVaultIntentKey } from "../programs/intents/create-vault";
import { CreateVaultIntent, CreateVaultIntentInput, CreateVaultPrivateInput, CreateVaultIntentProof } from "../programs/intents/create-vault";
import { KeyPair } from "../../../types/utility";
import { IntentProof } from "../types/intent-proof";
import { IntentProofStore } from "./intent-proof-store";

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

  constructor(args:{keypairs?: KeyPairs, intentProofStore?: IntentProofStore}){
    this.keypairs = args.keypairs ?? new KeyPairsImpl();
    this.intentProofStore = args.intentProofStore;
  }

  // |  BurnIntentProof }
  // |  MintIntentProof }
  // |  TransferIntentProof }
  // |  RedeemIntentProof }
  // |  CreateVaultIntentProof }
  // |  DepositIntentProof }
  // |  LiquidateIntentProof };

    // // for each of the proof types above define
    async addCreateVaultIntent(userAlias: KeyPairAlias, state: FullState): Promise<IntentProof> {

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
