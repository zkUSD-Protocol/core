import {
  Field,
  PrivateKey,
  PublicKey,
  UInt64,
} from "o1js";

import {
  Note,
  EncryptedNote,
  InputNotes,
  OutputNotes,
} from "../data/note.js";

import { KeyPair } from "../../../types/utility.js";
import { PaymentAddress } from "../types/keys.js";
import { FullState } from "../validator/block-state.js";
import { ZkUsdMap } from "../data/maps/zkusd-map.js";

export interface Wallet {
  keyPair(): KeyPair;
  notes(): Note[];
  addDecryptedNotes(encryptedNotes: EncryptedNote[]): void;
  createTransferNotes(args: {
    state: FullState;
    amount: UInt64;
    toPublicKey: PublicKey;
  }): { inputNotes: InputNotes; outputNotes: OutputNotes };
}

export class InMemoryWallet implements Wallet {
  private readonly _keyPair: KeyPair;
  private readonly _notes: Note[] = [];

  constructor(keyPair: KeyPair) {
    this._keyPair = keyPair;
  }

  keyPair(): KeyPair {
    return this._keyPair;
  }

  notes(): Note[] {
    return this._notes;
  }

  /**
   * Tries to decrypt and store unique notes that match the user's private key.
   */
  addDecryptedNotes(encryptedNotes: EncryptedNote[]): void {
    for (const encNote of encryptedNotes) {
      try {
        const note = Note.decrypt(encNote, this._keyPair.privateKey);
        const alreadyStored = this._notes.some(n =>
          n.hash().equals(note.hash()).toBoolean()
        );
        if (!alreadyStored) {
          this._notes.push(note);
        }
      } catch {
        // Ignore decryption failures silently
      }
    }
  }

  /**
   * Prepares input and output notes for a transfer.
   */
  createTransferNotes(args: {
    state: FullState;
    amount: UInt64;
    toPublicKey: PublicKey;
  }): { inputNotes: InputNotes; outputNotes: OutputNotes } {
    const { state, amount, toPublicKey } = args;
    const zkUsdMap = state.zkUsdMap;

    const inputNotes = InputNotes.empty();
    const outputNotes = OutputNotes.empty();

    // Sort available notes in descending order by amount
    const sortedNotes = [...this._notes].sort((a, b) =>
      b.amount.toBigInt() > a.amount.toBigInt() ? 1 : -1
    );

    let remainingAmount = amount.toBigInt();
    let usedNoteIndex = 0;

    for (const note of sortedNotes) {
      if (remainingAmount <= 0n) break;
      inputNotes.notes[usedNoteIndex++] = note;
      remainingAmount -= note.amount.toBigInt();
    }

    if (remainingAmount > 0n) {
      throw new Error("Insufficient balance: not enough notes to cover the transfer amount.");
    }

    // Output note for recipient
    const recipientNote = Note.create(
      amount,
      PaymentAddress.fromString(toPublicKey.toBase58()),
      Field.from(0),
      Field.random()
    );
    outputNotes.notes[0] = this.computeNoteNonce(zkUsdMap, recipientNote);

    // Change note back to sender
    const changeAmount = -remainingAmount;
    if (changeAmount <= 0n) {
      throw new Error("Internal logic error: no change note when expected.");
    }

    const changeNote = Note.create(
      UInt64.from(changeAmount),
      PaymentAddress.fromString(this._keyPair.publicKey.toBase58()),
      Field.random(),
      Field.random()
    );
    outputNotes.notes[1] = this.computeNoteNonce(zkUsdMap, changeNote);

    return {
      inputNotes: InputNotes.fromArray(inputNotes.notes),
      outputNotes: OutputNotes.fromArray(outputNotes.notes),
    };
  }

  /**
   * Generates a unique note by adjusting its nonce until not already in map.
   */
  private computeNoteNonce(zkUsdMap: ZkUsdMap, note: Note): Note {
    let hash = note.hash();
    while (zkUsdMap.isIncluded(hash).toBoolean()) {
      note.nonce = Field.random();
      hash = note.hash();
    }
    note.nonce = hash;
    return note;
  }
}

// Alias to represent wallet identifier
export type KeyPairAlias = number | string;

export interface Wallets {
  user(keyPairAlias: KeyPairAlias): Wallet;
}

/**
 * Wallet manager implementation using in-memory keypairs and wallets.
 */
export class WalletsImpl implements Wallets {
  private readonly _wallets: Map<KeyPairAlias, Wallet> = new Map();

  constructor() {}

  user(keyPairAlias: KeyPairAlias): Wallet {
    let wallet = this._wallets.get(keyPairAlias);
    if (!wallet) {
      const keyPair = PrivateKey.randomKeypair();
      wallet = new InMemoryWallet(keyPair);
      this._wallets.set(keyPairAlias, wallet);
    }
    return wallet;
  }
}