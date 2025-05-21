import {
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  Struct,
  UInt64,
  UInt8,
  ZkProgram,
} from 'o1js';
import { ZkUsdMap } from '../../data/zkusd-map.js';
import {
  InputNotes,
  MAX_INPUT_NOTE_COUNT,
  Note,
  Nullifiers,
  OutputNoteCommitment,
  Nullifier,
} from '../../data/note.js';
import { VaultMap } from '../../data/vault-map.js';
import { AggregateOraclePricesProof } from '../../../../proofs/oracle-price-aggregation/prove.js';
import { Vault, VaultUpdate } from '../../data/vault.js';

export class LiquidateIntentInput extends Struct({
  intentZkUsdMapRoot: Field,
  intentVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class LiquidateIntentOutput extends Struct({
  outputNoteCommitment: OutputNoteCommitment,
  nullifiers: Nullifiers,
  vaultUpdate: VaultUpdate,
}) {}

export class LiquidateIntentPrivateInput extends Struct({
  intentZkUsdMap: ZkUsdMap,
  intentVaultMap: VaultMap,
  priceProof: AggregateOraclePricesProof,
  inputNotes: InputNotes,
  outputNote: Note,
  spendingSignature: Signature,
  spendingPublicKey: PublicKey,
  nullifierKey: Field,
  vaultAddress: Field,
}) {}

export const LiquidateIntent = ZkProgram({
  name: 'LiquidateIntent',
  publicInput: LiquidateIntentInput,
  publicOutput: LiquidateIntentOutput,
  methods: {
    liquidate: {
      privateInputs: [LiquidateIntentPrivateInput],
      async method(
        publicInput: LiquidateIntentInput,
        intent: LiquidateIntentPrivateInput
      ): Promise<{ publicOutput: LiquidateIntentOutput }> {
        const nullifiers = Nullifiers.empty();
        const {
          intentZkUsdMap,
          intentVaultMap,
          priceProof,
          inputNotes,
          outputNote,
          spendingSignature,
          spendingPublicKey,
          nullifierKey,
          vaultAddress,
        } = intent;

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMap.root.assertEquals(publicInput.intentVaultMapRoot);

        priceProof.verify();

        const minaPrice = priceProof.publicOutput.minaPrice;

        //Ensure the vault is in the map
        intentVaultMap.assertIncluded(vaultAddress);

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(intentVaultMap.get(vaultAddress));

        spendingSignature.verify(spendingPublicKey, inputNotes.toFields());

        let valueIn = UInt64.zero;

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

          //We only want to make sure its part of the zkusd map if its not a dummy note
          const inNToCheck = Provable.if(inN.isDummy.not(), inNHash, Field(0));

          intentZkUsdMap.assertIncluded(inNToCheck);

          let liquidatorToCheck = Provable.if(
            inN.isDummy.not(),
            spendingPublicKey,
            PublicKey.empty()
          );

          inN.address.spendingPublicKey.assertEquals(liquidatorToCheck);

          //Make sure the nullifier is not spent
          intentZkUsdMap.assertNotIncluded(inNNullifier);

          //Add the nullifier to the nullifier map
          nullifiers.nullifiers[i] = Nullifier.create(inNNullifier);

          valueIn = valueIn.add(inN.amount);
        }

        const outN = outputNote;
        const outputNoteCommitment = OutputNoteCommitment.create(outN.hash());

        outN.amount.add(vault.debtAmount).assertEquals(valueIn);

        //assert the note is not already in the zkusd map
        intentZkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);

        //Liquidate the vault
        vault.liquidate(minaPrice);

        //Create the vault update
        const vaultUpdate = new VaultUpdate({
          vaultAddress: vaultAddress,
          vaultState: vault,
        });

        return {
          publicOutput: {
            outputNoteCommitment,
            nullifiers,
            vaultUpdate,
          },
        };
      },
    },
  },
});

export class LiquidateIntentProof extends ZkProgram.Proof(LiquidateIntent) {}
