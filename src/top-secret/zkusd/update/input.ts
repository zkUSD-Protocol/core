import { Field, Provable, PublicKey, Signature, Struct } from 'o1js';
import { ZkUsdState } from './common.js';
import { Note } from '../data/note.js';
import { NullifierWitness } from '../data/nullifier-map.js';
import { UtxoWitness } from '../data/utxo-tree.js';

/**
 * Public input for the ZkUSD program.
 */
export class ZkUsdInput extends Struct({
  // Current state of the system
  state: ZkUsdState,
  // Any additional inputs needed for operations
  // e.g., nullifiers, transaction metadata, etc.
}) {}

export const MAX_INPUT_NOTE_COUNT = 10;
export const MAX_OUTPUT_NOTE_COUNT = 2;

export class InputNotes extends Struct({
  notes: Provable.Array(Note, MAX_INPUT_NOTE_COUNT),
}) {
  toFields() {
    return this.notes.map((n) => n.toFields());
  }
}

export class ZkUsdTransferInput extends Struct({
  inputNotes: InputNotes,
  inputUtxoWitnesses: Provable.Array(UtxoWitness, MAX_INPUT_NOTE_COUNT),
  nullifierWitnesses: Provable.Array(NullifierWitness, MAX_INPUT_NOTE_COUNT),
  outputNotes: Provable.Array(Note, MAX_OUTPUT_NOTE_COUNT),
  outputUtxoWitnesses: Provable.Array(UtxoWitness, MAX_OUTPUT_NOTE_COUNT),
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
}) {}
