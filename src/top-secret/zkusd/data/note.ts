import {
  Field,
  Poseidon,
  PublicKey,
  Struct,
  UInt64,
  Encryption,
  PrivateKey,
  Bool,
} from 'o1js';
import { CipherText } from 'o1js/dist/node/lib/provable/crypto/encryption';
import { PaymentAddress } from '../types/keys.js';

export class Note extends Struct({
  amount: UInt64,
  address: PaymentAddress,
  secret: Field,
  nonce: Field,
  isDummy: Bool,
}) {
  static create(
    amount: UInt64,
    address: PaymentAddress,
    secret: Field,
    nonce: Field
  ): Note {
    return new Note({
      amount,
      address,
      secret,
      nonce,
      isDummy: Bool(false),
    });
  }

  static dummy(): Note {
    return new Note({
      amount: UInt64.from(0),
      address: new PaymentAddress({
        viewingPublicKey: PublicKey.empty(),
        spendingPublicKey: PublicKey.empty(),
      }),
      secret: Field.random(),
      nonce: Field.random(),
      isDummy: Bool(true),
    });
  }

  hash(): Field {
    return Poseidon.hash([
      this.amount.value,
      this.address.viewingPublicKey.toFields()[0],
      this.address.viewingPublicKey.toFields()[1],
      this.address.spendingPublicKey.toFields()[0],
      this.address.spendingPublicKey.toFields()[1],
      this.secret,
      this.nonce,
    ]);
  }

  toFields(): Field[] {
    return [
      this.amount.value,
      this.address.viewingPublicKey.toFields()[0],
      this.address.viewingPublicKey.toFields()[1],
      this.address.spendingPublicKey.toFields()[0],
      this.address.spendingPublicKey.toFields()[1],
      this.secret,
      this.nonce,
    ];
  }

  fromFields(fields: Field[]): Note {
    return new Note({
      amount: UInt64.fromFields([fields[0]]),
      address: new PaymentAddress({
        viewingPublicKey: PublicKey.fromFields([fields[1], fields[2]]),
        spendingPublicKey: PublicKey.fromFields([fields[3], fields[4]]),
      }),
      secret: fields[5],
      nonce: fields[6],
      isDummy: Bool(false),
    });
  }

  encrypt(): CipherText {
    return Encryption.encrypt(this.toFields(), this.address.viewingPublicKey);
  }

  //Takes a viewing private key and decrypts the note
  decrypt(CipherText: CipherText, key: PrivateKey): Note {
    const fields = Encryption.decrypt(CipherText, key);
    return this.fromFields(fields);
  }

  nullifier(nk: Field): Field {
    return Poseidon.hash([nk, this.secret]);
  }
}
