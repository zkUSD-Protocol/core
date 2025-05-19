import {
  assert,
  Field,
  Provable,
  PublicKey,
  SelfProof,
  Signature,
  UInt64,
  ZkProgram,
} from 'o1js';
import {
  MAX_INPUT_NOTE_COUNT,
  MAX_OUTPUT_NOTE_COUNT,
  ZkUsdTransferInput,
} from './update/input.js';
import { ZkUsdState } from './update/state.js';
import { UtxoWitness } from './data/utxo-tree.js';
import { Note } from './data/note.js';

export const ZkUsd = ZkProgram({
  name: 'ZkUsd',
  publicInput: ZkUsdState,
  publicOutput: ZkUsdState,
  methods: {
    mint: {
      privateInputs: [Note, UtxoWitness],
      async method(
        publicInput: ZkUsdState,
        note: Note,
        utxoWitness: UtxoWitness
      ): Promise<{ publicOutput: ZkUsdState }> {
        //First we have to ensure that the utxo tree root is correct

        const empty = Field(0);
        const oldRoot = publicInput.utxoTreeRoot;

        const calculatedUtxoTreeRoot = utxoWitness.calculateRoot(empty);
        calculatedUtxoTreeRoot.assertEquals(oldRoot);

        //Add the note to the utxo tree
        //Commitment
        const commitment = note.hash();

        const newRoot = utxoWitness.calculateRoot(commitment);

        return {
          publicOutput: new ZkUsdState({
            vaultMap: publicInput.vaultMap,
            utxoTreeRoot: newRoot,
            nullifierMap: publicInput.nullifierMap,
            sequence: publicInput.sequence.add(UInt64.from(1)),
            blockNumber: publicInput.blockNumber,
          }),
        };
      },
    },
    transfer: {
      privateInputs: [ZkUsdTransferInput],
      async method(
        publicInput: ZkUsdState,
        transferInput: ZkUsdTransferInput
      ): Promise<{ publicOutput: ZkUsdState }> {
        const empty = Field(0);
        const nullified = Field(1);
        let valueIn = UInt64.zero;
        let uRoot = publicInput.utxoTreeRoot;
        let spender = transferInput.spendingPublicKey;
        let spenderSig = transferInput.spendingSignature;
        let nullifierKey = transferInput.nullifierKey;
        let nullifierMap = transferInput.nullifierMap;

        spenderSig.verify(spender, transferInput.inputNotes.toFields().flat());

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = transferInput.inputNotes.notes[i];
          const inW = transferInput.inputUtxoWitnesses[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //Make sure the input note is part of the utxo tree
          const calculatedURoot = inW.calculateRoot(inNHash);

          const uRootToCheck = Provable.if(inN.isDummy, uRoot, calculatedURoot);

          uRootToCheck.assertEquals(uRoot);

          let spenderToCheck = Provable.if(
            inN.isDummy,
            PublicKey.empty(),
            spender
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          nullifierMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          nullifierMap.setIf(inN.isDummy.not(), inNNullifier, nullified);

          valueIn = valueIn.add(inN.amount);
        }

        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = transferInput.outputNotes[i];
          const outW = transferInput.outputUtxoWitnesses[i];

          outW.calculateRoot(empty).assertEquals(uRoot);
          uRoot = outW.calculateRoot(outN.hash());

          valueOut = valueOut.add(outN.amount);
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: new ZkUsdState({
            vaultMap: publicInput.vaultMap,
            utxoTreeRoot: uRoot,
            nullifierMap: nullifierMap,
            sequence: publicInput.sequence.add(UInt64.from(1)),
            blockNumber: publicInput.blockNumber,
          }),
        };
      },
    },
    merge: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        input: ZkUsdState,
        proof1: SelfProof<ZkUsdState, ZkUsdState>,
        proof2: SelfProof<ZkUsdState, ZkUsdState>
      ): Promise<{ publicOutput: ZkUsdState }> {
        proof1.verify();
        proof2.verify();

        ZkUsdState.assertEqual(input, proof1.publicInput);
        ZkUsdState.assertEqual(proof1.publicOutput, proof2.publicInput);

        return {
          publicOutput: proof2.publicOutput,
        };
      },
    },
  },
});

export class ZkUsdProof extends ZkProgram.Proof(ZkUsd) {}
