import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { PaymentAddress, Keys } from './types/keys.js';
import {
  Encryption,
  Field,
  PrivateKey,
  PublicKey,
  UInt64,
  initializeBindings,
} from 'o1js';
import { Note } from './data/note.js';
import { ZkUsd } from './program.js';
import { UtxoTree, UtxoWitness } from './data/utxo-tree.js';
import { NullifierMap } from './data/nullifier-map.js';
import { ZkUsdInput } from './update/input.js';

describe('ZkUsd Payment Address Test Suite', () => {
  let keys: Keys;
  let paymentAddress: PaymentAddress;
  let utxoTree: UtxoTree;
  let nullifierMap: NullifierMap;

  before(async () => {
    console.log('initializing bindings');
    await initializeBindings();

    console.log('compiling zkprogram');
    console.time('compiled zkprogram');
    await ZkUsd.compile();
    console.timeEnd('compiled zkprogram');

    let privateKey = PrivateKey.random();
    keys = Keys.fromPrivateKey(privateKey);
    paymentAddress = keys.paymentAddress;
    utxoTree = new UtxoTree();
    nullifierMap = new NullifierMap();
  });

  it('should create a valid payment address', () => {
    console.log(paymentAddress.spendingPublicKey.toBase58());
    console.log(paymentAddress.viewingPublicKey.toBase58());
  });

  it('should generate a valid private keys', () => {
    console.log(keys.viewingKey.toBase58());
    console.log(keys.spendingKey.toBase58());
  });

  it('should be able to encypt and decrypt a note', () => {
    const aliceKeys = Keys.fromPrivateKey(PrivateKey.random());
    const bobKeys = Keys.fromPrivateKey(PrivateKey.random());

    const note = Note.create(
      UInt64.from(1),
      aliceKeys.paymentAddress,
      Field(1),
      Field(1)
    );
    console.log('encrypting the note', note);
    const encryptedNote = note.encrypt();
    console.log('decrypting the note', encryptedNote);
    const decryptedNote = note.decrypt(encryptedNote, aliceKeys.viewingKey);
    console.log(decryptedNote);
    assert.deepStrictEqual(note, decryptedNote);
  });

  it('should be able to mint some zkusd', async () => {
    const aliceKeys = Keys.fromPrivateKey(PrivateKey.random());
    const bobKeys = Keys.fromPrivateKey(PrivateKey.random());

    const note = Note.create(
      UInt64.from(100e9),
      aliceKeys.paymentAddress,
      Field.random(),
      Field.random()
    );

    const witness = new UtxoTree.Witness(utxoTree.getWitness(utxoTree.next));

    utxoTree.insert(note.hash());

    console.log(witness);

    const input = new ZkUsdInput({
      state: {
        utxoTreeRoot: utxoTree.getRoot(),
        nullifierMapRoot: nullifierMap.getRoot(),
      },
    });

    const proof = await ZkUsd.mint(input, note, witness);

    console.log(proof);
  });
});
