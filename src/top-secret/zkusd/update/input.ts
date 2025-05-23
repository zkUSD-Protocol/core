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
  UInt8,
} from 'o1js';
import {
  Note,
  InputNotes,
  OutputNotes,
  MAX_INPUT_NOTE_COUNT,
  MAX_OUTPUT_NOTE_COUNT,
} from '../data/note.js';
import { ZkUsdMap } from '../data/zkusd-map.js';
import { PaymentAddress } from '../types/keys.js';
import { ZkUsdState } from '../data/state.js';
import { VaultMap } from '../data/vault-map.js';
import { AggregateOraclePricesProof } from '../../../proofs/oracle-price-aggregation/prove.js';

export class DepositCollateralInput extends Struct({
  vaultMap: VaultMap,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export class MintZkUsdInput extends Struct({
  vaultMap: VaultMap,
  zkUsdMap: ZkUsdMap,
  note: Note,
  aggregateOraclePricesProof: AggregateOraclePricesProof,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export class BurnInput extends Struct({
  vaultMap: VaultMap,
  zkUsdMap: ZkUsdMap,
  inputNotes: InputNotes,
  outputNote: Note,
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export class RedeemCollateralInput extends Struct({
  vaultMap: VaultMap,
  aggregateOraclePricesProof: AggregateOraclePricesProof,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export class LiquidateInput extends Struct({
  vaultMap: VaultMap,
  zkUsdMap: ZkUsdMap,
  minaPriceProof: AggregateOraclePricesProof,
  inputNotes: InputNotes,
  outputNote: Note,
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
  type: UInt8,
  ownerPublicKey: PublicKey,
}) {}

export class TransferInput extends Struct({
  inputNotes: InputNotes,
  outputNotes: OutputNotes,
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
}) {
  /**
   * Creates an empty transfer input with dummy values
   */
  static empty(): TransferInput {
    const dummyInputNotes = new InputNotes({
      notes: Array(MAX_INPUT_NOTE_COUNT).fill(Note.dummy()),
    });

    const dummyOutputNotes = new OutputNotes({
      notes: Array(MAX_OUTPUT_NOTE_COUNT).fill(Note.dummy()),
    });

    return new TransferInput({
      inputNotes: dummyInputNotes,
      outputNotes: dummyOutputNotes,
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
   * @returns A fully configured TransferInput ready for proving
   */
  static createTransfer(
    inputNotes: Note[],
    recipientAddress: PaymentAddress,
    amount: UInt64,
    spendingPrivateKey: PrivateKey,
    nullifierKey: Field
  ): TransferInput {
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

    const empty = Field(0);

    // Create the padded input notes array
    const paddedInputNotes = [...inputNotes];
    while (paddedInputNotes.length < MAX_INPUT_NOTE_COUNT) {
      paddedInputNotes.push(Note.dummy());
    }

    // Sign the input notes
    const inputNotesStruct = new InputNotes({
      notes: paddedInputNotes,
    });

    const outputNotesStruct = new OutputNotes({
      notes: outputNotes,
    });

    const signature = Signature.create(
      spendingPrivateKey,
      inputNotesStruct.toFields()
    );

    return new TransferInput({
      inputNotes: inputNotesStruct,
      outputNotes: outputNotesStruct,
      spendingSignature: signature,
      spendingPublicKey: spendingPrivateKey.toPublicKey(),
      nullifierKey,
    });
  }
}
