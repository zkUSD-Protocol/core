import { Field, Signature, UInt64, ZkProgram } from 'o1js';
import {
  MAX_INPUT_NOTE_COUNT,
  ZkUsdInput,
  ZkUsdTransferInput,
} from './update/input';
import { ZkUsdOutput } from './update/output';
import { ZkUsdState } from './update/common';
import { UtxoTree, UtxoWitness } from './data/utxo-tree';
import { NullifierMap } from './data/nullifier-map';
import { Note } from './data/note';

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
        let valueIn = UInt64.zero;
        let nRoot = publicInput.state.nullifierMapRoot;
        let spender = transferInput.spendingPublicKey;
        let spenderSig = transferInput.spendingSignature;

        spenderSig.verify(spender, transferInput.inputNotes.toFields().flat());

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = transferInput.inputNotes.notes[i];
          const inW = transferInput.inputUtxoWitnesses[i];
          const inNW = transferInput.nullifierWitnesses[i];
          const inNHash = inN.hash();

          inW
            .calculateRoot(inNHash)
            .assertEquals(publicInput.state.utxoTreeRoot);

          inN.address.spendingPublicKey.assertEquals(spender);
        }

        return {
          publicOutput: new ZkUsdOutput({
            state: {
              utxoTreeRoot: publicInput.state.utxoTreeRoot,
              nullifierMapRoot: publicInput.state.nullifierMapRoot,
            },
          }),
        };
      },
    },
  },
});
