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
  Encryption,
} from 'o1js';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { Note, OutputNoteCommitment } from '../../data/note.js';
import { VaultMap } from '../../data/maps/vault-map.js';
import { AggregateOraclePricesProof } from '../../../../proofs/oracle-price-aggregation/prove.js';
import { Vault, VaultUpdate } from '../../data/vault.js';

export class MintIntentInput extends Struct({
  intentZkUsdMapRoot: Field,
  intentVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class MintIntentOutput extends Struct({
  outputNoteCommitment: OutputNoteCommitment,
  vaultUpdate: VaultUpdate,
}) {}

export class MintIntentPrivateInput extends Struct({
  intentZkUsdMap: ZkUsdMap,
  intentVaultMap: VaultMap,
  note: Note,
  priceProof: AggregateOraclePricesProof, // Need to think about this for intent/rollup split
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export const MintIntent = ZkProgram({
  name: 'MintIntent',
  publicInput: MintIntentInput,
  publicOutput: MintIntentOutput,
  methods: {
    mint: {
      privateInputs: [MintIntentPrivateInput],
      async method(
        publicInput: MintIntentInput,
        intent: MintIntentPrivateInput
      ): Promise<{ publicOutput: MintIntentOutput }> {
        const {
          intentZkUsdMap,
          intentVaultMap,
          note,
          priceProof,
          type,
          ownerSignature,
          ownerPublicKey,
          amount,
        } = intent;

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);
        intentVaultMap.root.assertEquals(publicInput.intentVaultMapRoot);

        priceProof.verify();

        const minaPrice = priceProof.publicOutput.minaPrice;

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

        //Mint the zkusd
        vault.mintZkUsd(amount, minaPrice);

        //Ensure the note amount is the same as the minted amount
        note.amount.assertEquals(amount);

        const outputNoteCommitment = OutputNoteCommitment.create(note.hash());

        //assert the note is not already in the zkusd map
        intentZkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);

        const vaultUpdate = new VaultUpdate({
          vaultAddress: vaultKey,
          vaultState: vault,
        });

        return {
          publicOutput: {
            outputNoteCommitment,
            vaultUpdate,
          },
        };
      },
    },
  },
});

export class MintIntentProof extends ZkProgram.Proof(MintIntent) {}
