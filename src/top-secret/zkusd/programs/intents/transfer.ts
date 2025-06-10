import {
  Field,
  Provable,
  PublicKey,
  Signature,
  Struct,
  UInt64,
  ZkProgram,
} from 'o1js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import {
  InputNotes,
  MAX_INPUT_NOTE_COUNT,
  Nullifiers,
  OutputNotes,
  Nullifier,
  MAX_OUTPUT_NOTE_COUNT,
  OutputNoteCommitments,
  OutputNoteCommitment,
} from '../../data/note.js';

export class TransferIntentInput extends Struct({
  intentZkUsdMapRoot: Field,
}) {}

export class TransferIntentOutput extends Struct({
  nullifiers: Nullifiers,
  outputNoteCommitments: OutputNoteCommitments,
}) {}

export class TransferIntentPrivateInput extends Struct({
  intentZkUsdMap: ZkUsdMap,
  inputNotes: InputNotes,
  outputNotes: OutputNotes,
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
}) {}

export const TransferIntent = ZkProgram({
  name: 'TransferIntent',
  publicInput: TransferIntentInput,
  publicOutput: TransferIntentOutput,
  methods: {
    transfer: {
      privateInputs: [TransferIntentPrivateInput],
      async method(
        publicInput: TransferIntentInput,
        intent: TransferIntentPrivateInput
      ): Promise<{ publicOutput: TransferIntentOutput }> {
        const nullifiers = Nullifiers.empty();
        const outputNoteCommitments = OutputNoteCommitments.empty();

        const {
          intentZkUsdMap,
          inputNotes,
          outputNotes,
          spendingSignature,
          spendingPublicKey,
        } = intent;

        let valueIn = UInt64.zero;

        spendingSignature.verify(spendingPublicKey, inputNotes.toFields());

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(spendingSignature.r);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          intentZkUsdMap.assertIncluded(inNToCheck);

          let spenderToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          intentZkUsdMap.assertNotIncluded(inNNullifier);

          const nullifier = Provable.if(
            inN.isDummy.not(),
            Nullifier.create(inNNullifier),
            Nullifier.dummy()
          );

          nullifiers.nullifiers[i] = nullifier;

          valueIn = valueIn.add(inN.amount);
        }

        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = outputNotes.notes[i];
          const outNHash = outN.hash();

          intentZkUsdMap.assertNotIncluded(outNHash);

          const outputNoteCommitment = Provable.if(
            outN.isDummy.not(),
            OutputNoteCommitment.create(outNHash),
            OutputNoteCommitment.dummy()
          );

          outputNoteCommitments.commitments[i] = outputNoteCommitment;

          valueOut = valueOut.add(outN.amount);
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: {
            nullifiers,
            outputNoteCommitments,
          },
        };
      },
    },
  },
});

export class TransferIntentProof extends ZkProgram.Proof(TransferIntent) {}
