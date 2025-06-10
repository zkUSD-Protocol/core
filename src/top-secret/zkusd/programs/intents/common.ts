import { Field, Poseidon, PublicKey, Struct, UInt8 } from "o1js";

export const VaiultIntentKey = Field.from('420420001');
export const minaVaultType = UInt8.from(0);


export class VaultAddress extends Struct({
  key: Field,
}) {
    static fromPublicKey(publicKey: PublicKey, intentType: UInt8): VaultAddress {
        return mkVaultKey(publicKey, intentType);
    }

    static minaVaultKey(publicKey: PublicKey): VaultAddress {
        return mkVaultKey(publicKey, minaVaultType);
    }
}


// annotate return type
const mkVaultKey = (ownerPublicKey: PublicKey, intentType: UInt8): VaultAddress => new VaultAddress({
          key: Poseidon.hash([
            ...ownerPublicKey.toFields(),
            intentType.value,
            VaiultIntentKey
          ])
        });