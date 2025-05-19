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
import { Note } from './data/note.js';
import { ZkUsdMap } from './data/zkusd-map.js';
export const ZkUsd = ZkProgram({
  name: 'ZkUsd',
  publicInput: ZkUsdState,
  publicOutput: ZkUsdState,
  methods: {
    mint: {
      privateInputs: [Note],
      async method(
        publicInput: ZkUsdState,
        note: Note
      ): Promise<{ publicOutput: ZkUsdState }> {
        const zkUsdMap = publicInput.zkUsdMap;
        //First we have to ensure that the utxo tree root is correct
        const minted = Field(1);
        const commitment = note.hash();

        //Ensure its not already in the zkusd map
        zkUsdMap.assertNotIncluded(note.hash());

        //Add the note to the zkusd map
        zkUsdMap.set(commitment, minted);

        return {
          publicOutput: new ZkUsdState({
            vaultMap: publicInput.vaultMap,
            zkUsdMap: zkUsdMap,
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
        const included = Field(1);
        let zkUsdMap = publicInput.zkUsdMap;
        let valueIn = UInt64.zero;
        let spender = transferInput.spendingPublicKey;
        let spenderSig = transferInput.spendingSignature;
        let nullifierKey = transferInput.nullifierKey;

        spenderSig.verify(spender, transferInput.inputNotes.toFields());

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = transferInput.inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          zkUsdMap.assertIncluded(inNToCheck);

          let spenderToCheck = Provable.if(
            inN.isDummy.not(),
            spender,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(spenderToCheck);

          //Make sure the nullifier is not spent
          zkUsdMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          zkUsdMap.setIf(inN.isDummy.not(), inNNullifier, included);

          valueIn = valueIn.add(inN.amount);
        }

        let valueOut = UInt64.zero;

        for (let i = 0; i < MAX_OUTPUT_NOTE_COUNT; i++) {
          const outN = transferInput.outputNotes.notes[i];
          const outNHash = outN.hash();

          zkUsdMap.assertNotIncluded(outNHash);
          zkUsdMap.setIf(outN.isDummy.not(), outN.hash(), included);

          valueOut = valueOut.add(outN.amount);
        }

        valueIn.assertEquals(valueOut);

        return {
          publicOutput: new ZkUsdState({
            vaultMap: publicInput.vaultMap,
            zkUsdMap: zkUsdMap,
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
