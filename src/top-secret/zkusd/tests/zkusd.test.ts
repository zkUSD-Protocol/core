import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { PaymentAddress, Keys } from '../types/keys.js';
import {
  Encryption,
  Field,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
  initializeBindings,
} from 'o1js';
import { Note } from '../data/note.js';
import { ZkUsd, ZkUsdProof } from '../program.js';
import { ZkUsdTransferInput } from '../update/input.js';
import { ZkUsdState } from '../update/state.js';
import { VaultMap } from '../data/vault-map.js';
import { ZkUsdMap } from '../data/zkusd-map.js';
import { AggregateOraclePrices } from '../../../proofs/oracle-price-aggregation/prove.js';

describe('ZkUsd Payment Address Test Suite', () => {
  let keys: Keys;
  let zkUsdMap: ZkUsdMap;
  let vaultMap: VaultMap;
  let utxos: Note[] = [];
  let alice: Keys;
  let bob: Keys;
  let proofs: ZkUsdProof[] = [];
  let sequence: UInt64 = UInt64.from(0);
  let blockNumber: UInt32 = UInt32.from(0);
  let state: ZkUsdState;

  before(async () => {
    await initializeBindings();

    console.log('compiling zkprogram');
    console.time('compiled zkprogram');
    await AggregateOraclePrices.compile();
    await ZkUsd.compile();
    console.timeEnd('compiled zkprogram');

    const analysis = await ZkUsd.analyzeMethods();
    console.log('Analysis of merge method');
    console.log(analysis.merge.summary());
    console.log('Analysis of createVault method');
    console.log(analysis.createVault.summary());
    console.log('Analysis of depositCollateral method');
    console.log(analysis.depositCollateral.summary());
    console.log('Analysis of mint method');
    console.log(analysis.mintZkUsd.summary());
    console.log('Analysis of transfer method');
    console.log(analysis.transfer.summary());

    alice = Keys.fromPrivateKey(PrivateKey.random());
    bob = Keys.fromPrivateKey(PrivateKey.random());

    zkUsdMap = new ZkUsdMap();
    vaultMap = new VaultMap();

    state = new ZkUsdState({
      vaultMapRoot: vaultMap.root,
      zkUsdMapRoot: zkUsdMap.root,
      sequence,
      blockNumber,
    });
  });

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

  // it('should be able to mint some zkusd', async () => {
  //   console.log(
  //     'Creating Alice Note with spending key',
  //     alice.spendingKey.toBase58()
  //   );

  //   const note = Note.create(
  //     UInt64.from(100e9),
  //     alice.paymentAddress,
  //     Field.random(),
  //     Field.random()
  //   );

  //   const mint = await ZkUsd.mint(state, note, zkUsdMap);

  //   state = mint.proof.publicOutput;

  //   utxos.push(note);
  //   proofs.push(mint.proof);

  //   //Make sure the note is included in the zkusd map
  //   assert.deepStrictEqual(zkUsdMap.get(note.hash()), Field(1));
  // });

  // it('should be able to transfer zkusd', async () => {
  //   const aliceNote = utxos[0];

  //   console.log(
  //     'Alice note spending key',
  //     aliceNote.address.spendingPublicKey.toBase58()
  //   );

  //   console.log(
  //     'Alice note viewing key',
  //     aliceNote.address.viewingPublicKey.toBase58()
  //   );

  //   //This alters the state of the utxo tree and nullifier map
  //   //Alice transfers 10zkusd to Bob
  //   const txInput = ZkUsdTransferInput.createTransfer(
  //     [aliceNote],
  //     bob.paymentAddress,
  //     state,
  //     UInt64.from(10e9),
  //     alice.spendingKey,
  //     alice.nullifierKey
  //   );

  //   utxos.push(...txInput.outputNotes.notes);

  //   console.log('txInput', JSON.stringify(txInput, null, 2));

  //   const transfer = await ZkUsd.transfer(state, txInput, zkUsdMap);

  //   state = transfer.proof.publicOutput;

  //   proofs.push(transfer.proof);

  //   //Make sure the note is nullified in the zkusd map
  //   assert.deepStrictEqual(
  //     zkUsdMap.get(aliceNote.nullifier(alice.nullifierKey)),
  //     Field(1),
  //     'Alice note should be nullified'
  //   );

  //   //Make sure the output note is included in the zkusd map
  //   assert.deepStrictEqual(
  //     zkUsdMap.get(txInput.outputNotes.notes[0].hash()),
  //     Field(1),
  //     'Output note should be included'
  //   );

  //   //Make sure the change note is not included in the zkusd map
  //   assert.deepStrictEqual(
  //     zkUsdMap.get(txInput.outputNotes.notes[1].hash()),
  //     Field(1),
  //     'Change note should be included'
  //   );
  // });

  // it('should be able to merge state S0 -> S4', async () => {
  //   const bobsNote = utxos[1];
  //   const alicesNote = utxos[2];

  //   //First make a couple new transfers
  //   const txInput1 = ZkUsdTransferInput.createTransfer(
  //     [bobsNote],
  //     alice.paymentAddress,
  //     state,
  //     UInt64.from(5e9),
  //     bob.spendingKey,
  //     bob.nullifierKey
  //   );

  //   utxos.push(...txInput1.outputNotes.notes);

  //   const preTx1State = state;

  //   const tx1Transfer = await ZkUsd.transfer(state, txInput1, zkUsdMap);
  //   console.time('Tx 2 time');

  //   state = tx1Transfer.proof.publicOutput;

  //   const txInput2 = ZkUsdTransferInput.createTransfer(
  //     [alicesNote],
  //     bob.paymentAddress,
  //     state,
  //     UInt64.from(5e9),
  //     alice.spendingKey,
  //     alice.nullifierKey
  //   );

  //   utxos.push(...txInput2.outputNotes.notes);

  //   const tx2Transfer = await ZkUsd.transfer(state, txInput2, zkUsdMap);
  //   console.timeEnd('Tx 2 time');
  //   proofs.push(tx1Transfer.proof, tx2Transfer.proof);

  //   const initialState = ZkUsdState.new();

  //   const merge1 = await ZkUsd.merge(initialState, proofs[0], proofs[1]);
  //   const merge2 = await ZkUsd.merge(preTx1State, proofs[2], proofs[3]);

  //   proofs.push(merge1.proof, merge2.proof);

  //   console.time('Merge 3 time');
  //   const merge3 = await ZkUsd.merge(initialState, proofs[4], proofs[5]);
  //   console.timeEnd('Merge 3 time');
  //   proofs.push(merge3.proof);

  //   console.log('\n🔄 Proof Chain Visualization:');
  //   console.log('===========================================');

  //   const proofTypes = [
  //     'Mint',
  //     'Transfer 1 (Bob → Alice)',
  //     'Transfer 2 (Alice → Bob)',
  //     'Transfer 3 (Alice → Bob)',
  //     'Merge (Mint + Transfer 1)',
  //     'Merge (Transfer 2 + Transfer 3)',
  //     'Final Merge',
  //   ];

  //   for (let i = 0; i < proofs.length; i++) {
  //     const proof = proofs[i];
  //     const inputRoot =
  //       i < 4
  //         ? 'Initial State'
  //         : i === 4
  //           ? 'Mint + Transfer 1'
  //           : i === 5
  //             ? 'Transfer 2 + Transfer 3'
  //             : 'Combined State';

  //     const shortOutputRoots = {
  //       zkUsdMapRoot:
  //         proof.publicOutput.zkUsdMapRoot.toString().slice(0, 10) + '...',
  //     };

  //     const shortInputRoots = {
  //       zkUsdMapRoot:
  //         proof.publicInput.zkUsdMapRoot.toString().slice(0, 10) + '...',
  //     };

  //     console.log(`Proof #${i}: ${proofTypes[i]}`);
  //     console.log(`  ├─ Starting ZkUsd Root: ${shortInputRoots.zkUsdMapRoot}`);

  //     console.log(`  ├─ Ending ZkUsd Root: ${shortOutputRoots.zkUsdMapRoot}`);

  //     // Add merge visualization for merge proofs
  //     if (i >= 4) {
  //       const leftProofIndex = i === 4 ? 0 : 2;
  //       const rightProofIndex = i === 4 ? 1 : 3;
  //       const finalMerge = i === 6;

  //       if (finalMerge) {
  //         console.log(`  └─ Merging: Proof #4 + Proof #5`);
  //         console.log(`      │`);
  //         console.log(`      ├─ Left: (Mint + Transfer 1)`);
  //         console.log(`      └─ Right: (Transfer 2 + Transfer 3)`);
  //       } else {
  //         console.log(
  //           `  └─ Merging: Proof #${leftProofIndex} + Proof #${rightProofIndex}`
  //         );
  //         console.log(`      │`);
  //         console.log(`      ├─ Left: ${proofTypes[leftProofIndex]}`);
  //         console.log(`      └─ Right: ${proofTypes[rightProofIndex]}`);
  //       }
  //     }

  //     console.log('-------------------------------------------');
  //   }

  //   console.log('\nFinal Result:');
  //   console.log(
  //     `  Expected ZkUsd Root: ${zkUsdMap.root.toString().slice(0, 15)}...`
  //   );
  //   console.log(
  //     `  Actual ZkUsd Root:   ${proofs[6].publicOutput.zkUsdMapRoot.toString().slice(0, 15)}...`
  //   );
  //   console.log('===========================================');

  //   console.time('Verifying Proof 6');
  //   proofs[6].verify();
  //   console.timeEnd('Verifying Proof 6');
  // });
});
