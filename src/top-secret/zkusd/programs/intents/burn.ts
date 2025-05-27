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
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import {
  InputNotes,
  MAX_INPUT_NOTE_COUNT,
  Note,
  Nullifier,
  Nullifiers,
  OutputNoteCommitment,
} from '../../data/note.js';
import { VaultMap } from '../../data/maps/vault-map.js';
import { AggregateOraclePricesProof } from '../../../../proofs/oracle-price-aggregation/prove.js';
import { Vault, VaultUpdate } from '../../data/vault.js';

export class BurnIntentInput extends Struct({
  intentZkUsdMapRoot: Field,
  intentVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class BurnIntentOutput extends Struct({
  outputNoteCommitment: OutputNoteCommitment,
  nullifiers: Nullifiers,
  vaultUpdate: VaultUpdate,
}) {}

export class BurnIntentPrivateInput extends Struct({
  intentZkUsdMap: ZkUsdMap,
  intentVaultMap: VaultMap,
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

export const BurnIntent = ZkProgram({
  name: 'BurnIntent',
  publicInput: BurnIntentInput,
  publicOutput: BurnIntentOutput,
  methods: {
    burn: {
      privateInputs: [BurnIntentPrivateInput],
      async method(
        publicInput: BurnIntentInput,
        intent: BurnIntentPrivateInput
      ): Promise<{ publicOutput: BurnIntentOutput }> {
        const nullifiers = Nullifiers.empty();

        const {
          intentZkUsdMap,
          intentVaultMap,
          inputNotes,
          outputNote,
          spendingSignature,
          spendingPublicKey,
          nullifierKey,
          type,
          ownerSignature,
          ownerPublicKey,
          amount,
        } = intent;

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMap.root.assertEquals(publicInput.intentVaultMapRoot);

        const vaultKey = Poseidon.hash([
          ...ownerPublicKey.toFields(),
          type.value,
        ]);

        //Ensure the vault is in the map
        intentVaultMap.assertIncluded(vaultKey);

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(intentVaultMap.get(vaultKey));

        //Verify the owner signature
        ownerSignature.verify(ownerPublicKey, vault.toFields());

        spendingSignature.verify(spendingPublicKey, inputNotes.toFields());

        let valueIn = UInt64.zero;

        for (let i = 0; i < MAX_INPUT_NOTE_COUNT; i++) {
          const inN = inputNotes.notes[i];
          const inNHash = inN.hash();
          const inNNullifier = inN.nullifier(nullifierKey);

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

        const outN = outputNote;
        const outputNoteCommitment = OutputNoteCommitment.create(outN.hash());
        intentZkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);

        //Ensure the input amount is the same as the output amount + the amount to burn
        amount.add(outN.amount).assertEquals(valueIn);

        //Burn the zkusd
        vault.burnZkUsd(amount);

        //Create the vault update
        const vaultUpdate = new VaultUpdate({
          vaultAddress: vaultKey,
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

export class BurnIntentProof extends ZkProgram.Proof(BurnIntent) {}
