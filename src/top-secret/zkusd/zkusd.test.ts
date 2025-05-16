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
import { ZkUsd, ZkUsdProof } from './program.js';
import { UtxoTree, UtxoWitness } from './data/utxo-tree.js';
import { NullifierMap } from './data/nullifier-map.js';
import { ZkUsdTransferInput } from './update/input.js';
import { ZkUsdState } from './update/state.js';

describe('ZkUsd Payment Address Test Suite', () => {
  let keys: Keys;
  let utxoTree: UtxoTree;
  let nullifierMap: NullifierMap;
  let utxos: Note[] = [];
  let alice: Keys;
  let bob: Keys;
  let proofs: ZkUsdProof[] = [];

  before(async () => {
    await initializeBindings();

    console.log('compiling zkprogram');
    console.time('compiled zkprogram');
    await ZkUsd.compile();
    console.timeEnd('compiled zkprogram');

    alice = Keys.fromPrivateKey(PrivateKey.random());
    bob = Keys.fromPrivateKey(PrivateKey.random());

    utxoTree = new UtxoTree();
    nullifierMap = new NullifierMap();
  });

  function getState(): ZkUsdState {
    return new ZkUsdState({
      utxoTreeRoot: utxoTree.getRoot(),
      nullifierMapRoot: nullifierMap.getRoot(),
    });
  }

  //   it('should create a valid payment address', () => {});

  //   it('should generate a valid private keys', () => {});

  it('should be able to encypt and decrypt a note', () => {
    const note = Note.create(
      UInt64.from(1),
      alice.paymentAddress,
      Field(1),
      Field(1)
    );
    const encryptedNote = note.encrypt();
    const decryptedNote = note.decrypt(encryptedNote, alice.viewingKey);
    assert.deepStrictEqual(note, decryptedNote);
  });

  it('should be able to mint some zkusd', async () => {
    console.log(
      'Creating Alice Note with spending key',
      alice.spendingKey.toBase58()
    );

    const note = Note.create(
      UInt64.from(100e9),
      alice.paymentAddress,
      Field.random(),
      Field.random()
    );

    const witness = new UtxoTree.Witness(
      utxoTree.getWitness(note.nonce.toBigInt())
    );

    const state = new ZkUsdState({
      utxoTreeRoot: utxoTree.getRoot(),
      nullifierMapRoot: nullifierMap.getRoot(),
    });

    utxoTree.setLeaf(note.nonce.toBigInt(), note.hash());
    const mint = await ZkUsd.mint(state, note, witness);

    utxos.push(note);
    proofs.push(mint.proof);
    assert.deepStrictEqual(
      mint.proof.publicOutput.utxoTreeRoot,
      utxoTree.getRoot()
    );
  });

  it('should be able to transfer zkusd', async () => {
    const aliceNote = utxos[0];

    console.log(
      'Alice note spending key',
      aliceNote.address.spendingPublicKey.toBase58()
    );

    console.log(
      'Alice note viewing key',
      aliceNote.address.viewingPublicKey.toBase58()
    );

    const initialState = getState();

    //This alters the state of the utxo tree and nullifier map
    //Alice transfers 10zkusd to Bob
    const txInput = ZkUsdTransferInput.createTransfer(
      [aliceNote],
      utxoTree,
      nullifierMap,
      bob.paymentAddress,
      UInt64.from(10e9),
      alice.spendingKey,
      alice.nullifierKey
    );

    utxos.push(...txInput.outputNotes);

    const transfer = await ZkUsd.transfer(initialState, txInput);

    proofs.push(transfer.proof);

    assert.deepStrictEqual(
      transfer.proof.publicOutput.utxoTreeRoot,
      utxoTree.getRoot()
    );

    assert.deepStrictEqual(
      transfer.proof.publicOutput.nullifierMapRoot,
      nullifierMap.getRoot()
    );
  });

  it('should be able to merge state S0 -> S4', async () => {
    const bobsNote = utxos[1];
    const alicesNote = utxos[2];

    const preTx1State = getState();

    //First make a couple new transfers
    const txInput1 = ZkUsdTransferInput.createTransfer(
      [bobsNote],
      utxoTree,
      nullifierMap,
      alice.paymentAddress,
      UInt64.from(5e9),
      bob.spendingKey,
      bob.nullifierKey
    );

    utxos.push(...txInput1.outputNotes);

    const preTx2State = getState();

    const txInput2 = ZkUsdTransferInput.createTransfer(
      [alicesNote],
      utxoTree,
      nullifierMap,
      bob.paymentAddress,
      UInt64.from(5e9),
      alice.spendingKey,
      alice.nullifierKey
    );

    utxos.push(...txInput2.outputNotes);

    const tx1Transfer = await ZkUsd.transfer(preTx1State, txInput1);
    console.time('Tx 2 time');
    const tx2Transfer = await ZkUsd.transfer(preTx2State, txInput2);
    console.timeEnd('Tx 2 time');
    proofs.push(tx1Transfer.proof, tx2Transfer.proof);

    const initialState = new ZkUsdState({
      utxoTreeRoot: new UtxoTree().getRoot(),
      nullifierMapRoot: new NullifierMap().getRoot(),
    });

    const merge1 = await ZkUsd.merge(initialState, proofs[0], proofs[1]);
    const merge2 = await ZkUsd.merge(preTx1State, proofs[2], proofs[3]);

    proofs.push(merge1.proof, merge2.proof);

    console.time('Merge 3 time');
    const merge3 = await ZkUsd.merge(initialState, proofs[4], proofs[5]);
    console.timeEnd('Merge 3 time');
    proofs.push(merge3.proof);

    console.log('\n🔄 Proof Chain Visualization:');
    console.log('===========================================');

    const proofTypes = [
      'Mint',
      'Transfer 1 (Bob → Alice)',
      'Transfer 2 (Alice → Bob)',
      'Transfer 3 (Alice → Bob)',
      'Merge (Mint + Transfer 1)',
      'Merge (Transfer 2 + Transfer 3)',
      'Final Merge',
    ];

    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      const inputRoot =
        i < 4
          ? 'Initial State'
          : i === 4
            ? 'Mint + Transfer 1'
            : i === 5
              ? 'Transfer 2 + Transfer 3'
              : 'Combined State';

      const shortOutputRoots = {
        utxoTreeRoot:
          proof.publicOutput.utxoTreeRoot.toString().slice(0, 10) + '...',
        nullifierMapRoot:
          proof.publicOutput.nullifierMapRoot.toString().slice(0, 10) + '...',
      };

      const shortInputRoots = {
        utxoTreeRoot:
          proof.publicInput.utxoTreeRoot.toString().slice(0, 10) + '...',
        nullifierMapRoot:
          proof.publicInput.nullifierMapRoot.toString().slice(0, 10) + '...',
      };

      console.log(`Proof #${i}: ${proofTypes[i]}`);
      console.log(
        `  ├─ Starting Nullifier Root: ${shortInputRoots.nullifierMapRoot}`
      );
      console.log(`  ├─ Starting UTXO Root: ${shortInputRoots.utxoTreeRoot}`);
      console.log(
        `  ├─ Ending Nullifier Root: ${shortOutputRoots.nullifierMapRoot}`
      );
      console.log(`  └─ Ending UTXO Root: ${shortOutputRoots.utxoTreeRoot}`);

      // Add merge visualization for merge proofs
      if (i >= 4) {
        const leftProofIndex = i === 4 ? 0 : 2;
        const rightProofIndex = i === 4 ? 1 : 3;
        const finalMerge = i === 6;

        if (finalMerge) {
          console.log(`  └─ Merging: Proof #4 + Proof #5`);
          console.log(`      │`);
          console.log(`      ├─ Left: (Mint + Transfer 1)`);
          console.log(`      └─ Right: (Transfer 2 + Transfer 3)`);
        } else {
          console.log(
            `  └─ Merging: Proof #${leftProofIndex} + Proof #${rightProofIndex}`
          );
          console.log(`      │`);
          console.log(`      ├─ Left: ${proofTypes[leftProofIndex]}`);
          console.log(`      └─ Right: ${proofTypes[rightProofIndex]}`);
        }
      }

      console.log('-------------------------------------------');
    }

    console.log('\nFinal Result:');
    console.log(
      `  Expected UTXO Root: ${utxoTree.getRoot().toString().slice(0, 15)}...`
    );
    console.log(
      `  Actual UTXO Root:   ${proofs[6].publicOutput.utxoTreeRoot.toString().slice(0, 15)}...`
    );
    console.log('===========================================');

    console.time('Verifying Proof 6');
    proofs[6].verify();
    console.timeEnd('Verifying Proof 6');
  });
});
