import {
  Bool,
  Field,
  PrivateKey,
  Provable,
  PublicKey,
  Signature,
  Struct,
  UInt32,
  UInt64,
} from 'o1js';
import { Note } from '../data/note.js';
import { NullifierMap } from '../data/nullifier-map.js';
import { UtxoTree, UtxoWitness } from '../data/utxo-tree.js';
import { PaymentAddress } from '../types/keys.js';
import { ZkUsdState } from './state.js';
import { VaultMap } from '../data/vault-map.js';

export const MAX_INPUT_NOTE_COUNT = 3;
export const MAX_OUTPUT_NOTE_COUNT = 2;

export class InputNotes extends Struct({
  notes: Provable.Array(Note, MAX_INPUT_NOTE_COUNT),
}) {
  toFields() {
    return this.notes.map((n) => n.toFields()).flat();
  }
}

export class ZkUsdTransferInput extends Struct({
  inputNotes: InputNotes,
  inputUtxoWitnesses: Provable.Array(UtxoWitness, MAX_INPUT_NOTE_COUNT),
  nullifierMap: NullifierMap,
  outputNotes: Provable.Array(Note, MAX_OUTPUT_NOTE_COUNT),
  outputUtxoWitnesses: Provable.Array(UtxoWitness, MAX_OUTPUT_NOTE_COUNT),
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
}) {
  /**
   * Creates an empty transfer input with dummy values
   */
  static empty(): ZkUsdTransferInput {
    const dummyInputNotes = new InputNotes({
      notes: Array(MAX_INPUT_NOTE_COUNT).fill(Note.dummy()),
    });

    return new ZkUsdTransferInput({
      inputNotes: dummyInputNotes,
      inputUtxoWitnesses: Array(MAX_INPUT_NOTE_COUNT).fill(
        new UtxoWitness(Array(UtxoWitness.HEIGHT).fill(Field(0)))
      ),
      nullifierMap: new NullifierMap(),
      outputNotes: Array(MAX_OUTPUT_NOTE_COUNT).fill(Note.dummy()),
      outputUtxoWitnesses: Array(MAX_OUTPUT_NOTE_COUNT).fill(
        new UtxoWitness(Array(UtxoWitness.HEIGHT).fill(Field(0)))
      ),
      spendingSignature: Signature.empty(),
      spendingPublicKey: PublicKey.empty(),
      nullifierKey: Field(0),
    });
  }

  /**
   * Creates a transfer input that sends a specific amount to a recipient
   *
   * @param inputNotes - The notes to spend
   * @param utxoTree - The current UTXO tree to get witnesses
   * @param nullifierMap - The current nullifier map to get witnesses
   * @param recipientAddress - The recipient's payment address
   * @param amount - The amount to transfer
   * @param spendingPrivateKey - The sender's private key for signing
   * @param nullifierKey - The nullifier key for creating nullifiers
   * @returns A fully configured ZkUsdTransferInput ready for proving
   */
  static createTransfer(
    inputNotes: Note[],
    utxoTree: UtxoTree,
    recipientAddress: PaymentAddress,
    currentState: ZkUsdState,
    amount: UInt64,
    spendingPrivateKey: PrivateKey,
    nullifierKey: Field
  ): { input: ZkUsdTransferInput; state: ZkUsdState } {
    //Clone the state

    const uT = utxoTree;

    if (inputNotes.length > MAX_INPUT_NOTE_COUNT) {
      throw new Error(
        `Too many input notes. Maximum allowed is ${MAX_INPUT_NOTE_COUNT}`
      );
    }

    // Calculate total input amount
    let totalInput = UInt64.from(0);
    for (const note of inputNotes) {
      totalInput = totalInput.add(note.amount);
    }

    // Ensure we have enough funds
    if (totalInput.lessThan(amount).toBoolean()) {
      throw new Error('Insufficient funds in input notes');
    }

    // Create change note if needed
    const change = totalInput.sub(amount);
    const changeNote = change.equals(UInt64.from(0)).toBoolean()
      ? Note.dummy()
      : Note.create(
          change,
          new PaymentAddress({
            viewingPublicKey: inputNotes[0].address.viewingPublicKey,
            spendingPublicKey: inputNotes[0].address.spendingPublicKey,
          }),
          Field.random(),
          Field.random()
        );

    // Create recipient note
    const recipientNote = Note.create(
      amount,
      recipientAddress,
      Field.random(),
      Field.random()
    );

    // Prepare output notes array
    const outputNotes = [recipientNote, changeNote];

    // Get witnesses for input notes
    const inputUtxoWitnesses: UtxoWitness[] = [];

    const empty = Field(0);

    for (const note of inputNotes) {
      const commitment = note.hash();
      const utxoIndex = note.nonce.toBigInt();

      const utxoWitness = new UtxoWitness(uT.getWitness(utxoIndex));

      const utxo = uT.getLeaf(utxoIndex);

      utxo.assertEquals(
        commitment,
        `Input note: ${JSON.stringify(note)} not found in UTXO tree`
      );

      inputUtxoWitnesses.push(utxoWitness);
    }

    // Pad arrays with dummy values if needed
    while (inputUtxoWitnesses.length < MAX_INPUT_NOTE_COUNT) {
      inputUtxoWitnesses.push(UtxoWitness.dummy());
    }

    // Find available positions in UTXO tree for output notes
    const outputUtxoWitnesses: UtxoWitness[] = [];

    for (const note of outputNotes) {
      const witness = new UtxoWitness(uT.getWitness(note.nonce.toBigInt()));

      const utxo = uT.getLeaf(note.nonce.toBigInt());
      utxo.assertEquals(
        empty,
        `Index already taken for output note: ${JSON.stringify(utxo)}`
      );

      outputUtxoWitnesses.push(witness);

      uT.setLeaf(note.nonce.toBigInt(), note.hash());
    }

    // Pad output witnesses if needed
    while (outputUtxoWitnesses.length < MAX_OUTPUT_NOTE_COUNT) {
      outputUtxoWitnesses.push(UtxoWitness.dummy());
    }

    // Create the padded input notes array
    const paddedInputNotes = [...inputNotes];
    while (paddedInputNotes.length < MAX_INPUT_NOTE_COUNT) {
      paddedInputNotes.push(Note.dummy());
    }

    // Sign the input notes
    const inputNotesStruct = new InputNotes({
      notes: paddedInputNotes,
    });

    const signature = Signature.create(
      spendingPrivateKey,
      inputNotesStruct.toFields()
    );

    const input = new ZkUsdTransferInput({
      inputNotes: inputNotesStruct,
      inputUtxoWitnesses,
      nullifierMap: currentState.nullifierMap,
      outputNotes: outputNotes,
      outputUtxoWitnesses,
      spendingSignature: signature,
      spendingPublicKey: spendingPrivateKey.toPublicKey(),
      nullifierKey,
    });

    const state = new ZkUsdState({
      vaultMap: currentState.vaultMap,
      utxoTreeRoot: uT.getRoot(),
      nullifierMap: currentState.nullifierMap,
      sequence: currentState.sequence.add(UInt64.from(1)),
      blockNumber: currentState.blockNumber,
    });

    return {
      input,
      state,
    };
  }
}
