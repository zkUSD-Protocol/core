import {
  Field,
  Poseidon,
  PublicKey,
  Struct,
  UInt64,
  Encryption,
  PrivateKey,
  Bool,
  Provable,
  Group,
} from 'o1js';
import { CipherText } from 'o1js/dist/node/lib/provable/crypto/encryption';
import { PaymentAddress } from '../types/keys.js';

export const MAX_INPUT_NOTE_COUNT = 3;
export const MAX_OUTPUT_NOTE_COUNT = 2;

export type EncryptedNote = {
  cipherText: CipherText
}

export function serializeEncryptedNote(note: EncryptedNote){
  return {
    publicKey: note.cipherText.publicKey.toFields().map((f) => f.toString()),
    cipherText: note.cipherText.cipherText.map((f) => f.toString()),
  }
}

export function deserializeEncryptedNote(note: {
  publicKey: string[];
  cipherText: string[];
}): EncryptedNote {
  return {
    cipherText: {
      publicKey: Group.fromFields(note.publicKey.map((f) => Field(f))),
      cipherText: note.cipherText.map((f) => Field(f)),
    },
  };
}


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

  static included(): Field {
    return Field(1);
  }

  static notIncluded(): Field {
    return Field(0);
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

  encrypt(): EncryptedNote {
    return {
      cipherText: Encryption.encrypt(this.toFields(), this.address.viewingPublicKey)
    }
  }

  //Takes a viewing private key and decrypts the note
  decrypt(encryptedNote: EncryptedNote, key: PrivateKey): Note {
    const fields = Encryption.decrypt(encryptedNote.cipherText, key);
    return this.fromFields(fields);
  }

  nullifier(nk: Field): Field {
    return Poseidon.hash([nk, this.secret]);
  }
}

export class InputNotes extends Struct({
  notes: Provable.Array(Note, MAX_INPUT_NOTE_COUNT),
}) {
  toFields() {
    return this.notes.map((n) => n.toFields()).flat();
  }
}

export class OutputNotes extends Struct({
  notes: Provable.Array(Note, MAX_OUTPUT_NOTE_COUNT),
}) {
  toFields() {
    return this.notes.map((n) => n.toFields()).flat();
  }
}

export class OutputNoteCommitment extends Struct({
  commitment: Field,
  isDummy: Bool,
}) {
  static dummy(): OutputNoteCommitment {
    return new OutputNoteCommitment({
      commitment: Field(0),
      isDummy: Bool(true),
    });
  }

  static create(commitment: Field): OutputNoteCommitment {
    return new OutputNoteCommitment({
      commitment,
      isDummy: Bool(false),
    });
  }

  toFields() {
    return [this.commitment, this.isDummy.toFields()[0]];
  }
}
export class OutputNoteCommitments extends Struct({
  commitments: Provable.Array(OutputNoteCommitment, MAX_OUTPUT_NOTE_COUNT),
}) {
  static empty(): OutputNoteCommitments {
    return new OutputNoteCommitments({
      commitments: Array.from({ length: MAX_OUTPUT_NOTE_COUNT }, () =>
        OutputNoteCommitment.dummy()
      ),
    });
  }

  toFields() {
    return this.commitments.map((c) => c.toFields()).flat();
  }
}

export class Nullifier extends Struct({
  nullifier: Field,
  isDummy: Bool,
}) {
  toFields(): Field[] {
    return [this.nullifier, this.isDummy.toFields()[0]];
  }

  static included(): Field {
    return Field(1);
  }

  static notIncluded(): Field {
    return Field(0);
  }

  static create(nullifier: Field): Nullifier {
    return new Nullifier({
      nullifier,
      isDummy: Bool(false),
    });
  }

  static dummy(): Nullifier {
    return new Nullifier({
      nullifier: Field.from(0),
      isDummy: Bool(true),
    });
  }
}
export class Nullifiers extends Struct({
  nullifiers: Provable.Array(Nullifier, MAX_INPUT_NOTE_COUNT),
}) {
  static empty(): Nullifiers {
    return new Nullifiers({
      nullifiers: Array.from({ length: MAX_INPUT_NOTE_COUNT }, () =>
        Nullifier.dummy()
      ),
    });
  }

  toFields() {
    return this.nullifiers.map((n) => n.toFields()).flat();
  }
}
