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
import { VaultAddress } from './common.js';

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
        } = intent;

        intentZkUsdMap.root.assertEquals(publicInput.intentZkUsdMapRoot);
        Provable.log('intentVaultMapRoot checked');
        intentVaultMap.root.assertEquals(publicInput.intentVaultMapRoot);
        Provable.log('intentVaultMapRoot checked');

        priceProof.verify();
        Provable.log('priceProof verified');

        const minaPrice = priceProof.publicOutput.minaPrice;

        const vaultKey = VaultAddress.fromPublicKey(ownerPublicKey, type);

        //Ensure the vault is in the map
        intentVaultMap.assertIncluded(vaultKey.key);
        Provable.log('vault included');

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(intentVaultMap.get(vaultKey.key));

        // vault balances
        Provable.log('vault collateral', vault.collateralAmount.toString());
        Provable.log('vault debt', vault.debtAmount.toString());

        // price proof mina price
        minaPrice.priceNanoUSD = UInt64.from(1e9);
        Provable.log('mina price', minaPrice.priceNanoUSD.div(1e9).toString());

        //Verify the owner signature
        ownerSignature.verify(ownerPublicKey, vault.toFields());
        Provable.log('owner signature verified');

        //Mint the zkusd
        vault.mintZkUsd(note.amount, minaPrice);
        Provable.log('zkusd minted', note.amount.toString());

        const outputNoteCommitment = OutputNoteCommitment.create(note.hash());

        //assert the note is not already in the zkusd map
        intentZkUsdMap.assertNotIncluded(outputNoteCommitment.commitment);
        Provable.log('note not already in zkusd map');

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
