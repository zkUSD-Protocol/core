import { Field, Provable, PublicKey, Signature, UInt64, ZkProgram } from 'o1js';
import {
  MAX_INPUT_NOTE_COUNT,
  MAX_OUTPUT_NOTE_COUNT,
  ZkUsdInput,
  ZkUsdTransferInput,
} from './update/input.js';
import { ZkUsdOutput } from './update/output.js';
import { UtxoWitness } from './data/utxo-tree.js';
import { Note } from './data/note.js';

export const ZkUsd = ZkProgram({
  name: 'ZkUsd',
  publicInput: ZkUsdInput,
  publicOutput: ZkUsdOutput,
  methods: {
    mint: {
      privateInputs: [Note, UtxoWitness],
      async method(
        publicInput: ZkUsdInput,
        note: Note,
        utxoWitness: UtxoWitness
      ): Promise<{ publicOutput: ZkUsdOutput }> {
        //First we have to ensure that the utxo tree root is correct

        const empty = Field(0);
        const oldRoot = publicInput.state.utxoTreeRoot;

        const calculatedUtxoTreeRoot = utxoWitness.calculateRoot(empty);
        calculatedUtxoTreeRoot.assertEquals(oldRoot);

        //Add the note to the utxo tree
        //Commitment
        const commitment = note.hash();

        const newRoot = utxoWitness.calculateRoot(commitment);

        return {
          publicOutput: new ZkUsdOutput({
            state: {
              utxoTreeRoot: newRoot,
              nullifierMapRoot: publicInput.state.nullifierMapRoot,
            },
          }),
        };
      },
    },
    transfer: {
      privateInputs: [ZkUsdTransferInput],
      async method(
        publicInput: ZkUsdInput,
        transferInput: ZkUsdTransferInput
      ): Promise<{ publicOutput: ZkUsdOutput }> {
        const empty = Field(0);
        const nullified = Field(1);
        let valueIn = UInt64.zero;
        let oldNRoot = publicInput.state.nullifierMapRoot;
        let spender = transferInput.spendingPublicKey;
        let spenderSig = transferInput.spendingSignature;
        let nullifierKey = transferInput.nullifierKey;

        spenderSig.verify(spender, transferInput.inputNotes.toFields().flat());

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = transferInput.inputNotes.notes[i];
          const inW = transferInput.inputUtxoWitnesses[i];
          const inNNW = transferInput.nullifierWitnesses[i];
          const inNHash = inN.hash();

          inW
            .calculateRoot(inNHash)
            .assertEquals(publicInput.state.utxoTreeRoot);

          spender = Provable.if(
            inN.isDummy,
            PublicKey.empty(),
            inN.address.spendingPublicKey
          );

          inN.address.spendingPublicKey.assertEquals(spender);

          const [rBefore, key] = inNNW.computeRootAndKey(empty);
          rBefore.assertEquals(oldNRoot);

          key.assertEquals(inN.nullifier(nullifierKey));

          valueIn = valueIn.add(inN.amount);
        }

        let newNRoot = oldNRoot;

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const nW = transferInput.nullifierWitnesses[i];
          const [rAfter, _] = nW.computeRootAndKey(nullified);
          newNRoot = rAfter;
        }

        let newURoot = publicInput.state.utxoTreeRoot;
        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = transferInput.outputNotes[i];
          const outW = transferInput.outputUtxoWitnesses[i];

          outW.calculateRoot(empty).assertEquals(newURoot);
          valueOut = valueOut.add(outN.amount);
        }

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = transferInput.outputNotes[i];
          const outW = transferInput.outputUtxoWitnesses[i];

          newURoot = outW.calculateRoot(outN.hash());
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: new ZkUsdOutput({
            state: {
              utxoTreeRoot: newURoot,
              nullifierMapRoot: newNRoot,
            },
          }),
        };
      },
    },
  },
});

export class ZkUsdProof extends ZkProgram.Proof(ZkUsd) {}
