import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { PaymentAddress, Keys } from './types/keys.js';
import {
  Encryption,
  Field,
  PrivateKey,
  PublicKey,
  initializeBindings,
} from 'o1js';
import { Note } from './data/note.js';

describe('ZkUsd Payment Address Test Suite', () => {
  let keys: Keys;
  let paymentAddress: PaymentAddress;

  before(async () => {
    await initializeBindings();
    let privateKey = PrivateKey.random();
    keys = Keys.fromPrivateKey(privateKey);
    paymentAddress = keys.paymentAddress;
  });

  it('should create a valid payment address', () => {
    console.log(paymentAddress.spendingPublicKey.toBase58());
    console.log(paymentAddress.viewingPublicKey.toBase58());
  });

  it('should generate a valid private keys', () => {
    console.log(keys.viewingKey.toBase58());
    console.log(keys.spendingKey.toBase58());
  });

  it('We should be able to encypt and decrypt a note', () => {
    const aliceKeys = Keys.fromPrivateKey(PrivateKey.random());
    const bobKeys = Keys.fromPrivateKey(PrivateKey.random());

    const note = Note.create(100, aliceKeys.paymentAddress, Field(1), Field(1));
    console.log('encrypting the note', note);
    const encryptedNote = note.encrypt();
    console.log('decrypting the note', encryptedNote);
    const decryptedNote = note.decrypt(encryptedNote, aliceKeys.viewingKey);
    console.log(decryptedNote);
    assert.deepStrictEqual(note, decryptedNote);
  });
});
