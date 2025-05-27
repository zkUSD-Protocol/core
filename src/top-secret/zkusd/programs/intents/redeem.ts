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
import { Vault, VaultState, VaultUpdate } from '../../data/vault.js';

export class RedeemIntentInput extends Struct({
  intentVaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class RedeemIntentOutput extends Struct({
  vaultUpdate: VaultUpdate,
}) {}

export class RedeemIntentPrivateInput extends Struct({
  intentVaultMap: VaultMap,
  type: UInt8,
  priceProof: AggregateOraclePricesProof,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

export const RedeemIntent = ZkProgram({
  name: 'RedeemIntent',
  publicInput: RedeemIntentInput,
  publicOutput: RedeemIntentOutput,
  methods: {
    redeem: {
      privateInputs: [RedeemIntentPrivateInput],
      async method(
        publicInput: RedeemIntentInput,
        intent: RedeemIntentPrivateInput
      ): Promise<{ publicOutput: RedeemIntentOutput }> {
        const {
          intentVaultMap,
          type,
          priceProof,
          ownerSignature,
          ownerPublicKey,
          amount,
        } = intent;

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

        // TODO compute signature fields
        const message: Field[] =  [];

        //Verify the owner signature
        ownerSignature.verify(ownerPublicKey, message);

        //Redeem the zkusd
        vault.redeemCollateral(amount, minaPrice);

        //Create the vault update
        const vaultUpdate = new VaultUpdate({
          vaultAddress: vaultKey,
          vaultState: vault,
        });

        return {
          publicOutput: {
            vaultUpdate,
          },
        };
      },
    },
  },
});

export class RedeemIntentProof extends ZkProgram.Proof(RedeemIntent) {}
