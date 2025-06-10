import {
  Field,
  Poseidon,
  PublicKey,
  Signature,
  Struct,
  UInt64,
  UInt8,
  ZkProgram,
} from 'o1js';
import { VaultMap } from '../../data/maps/vault-map.js';
import { Vault } from '../../data/vault.js';
import { VaultAddress } from './common.js';

export class DepositIntentInput extends Struct({
  vaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class DepositIntentOutput extends Struct({
  vaultKey: VaultAddress,
  vaultPack: Field,
}) {}

export class DepositPrivateInput extends Struct({
  vaultMap: VaultMap,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
  amount: UInt64,
}) {}

// todo: make it better?
export const DepositIntentKey = Field.from('420420002');

export const DepositIntent = ZkProgram({
  name: 'DepositIntent',
  publicInput: DepositIntentInput,
  publicOutput: DepositIntentOutput,
  methods: {
    deposit: {
      privateInputs: [DepositPrivateInput],
      async method(
        publicInput: DepositIntentInput,
        privateInput: DepositPrivateInput
      ): Promise<{ publicOutput: DepositIntentOutput }> {
        const { vaultMapRoot } = publicInput;
        const { type, ownerSignature, ownerPublicKey, vaultMap } = privateInput;

        // validate vault map
        vaultMap.root.assertEquals(vaultMapRoot);

        // signature message
        const message: Field[] = [vaultMapRoot, type.value, DepositIntentKey];

        // Validate the owner's signature
        const isValidSignature = ownerSignature.verify(ownerPublicKey, message);
        isValidSignature.assertTrue('Invalid signature');

        // vault key (hiding public key)
        const vaultKey: VaultAddress = VaultAddress.fromPublicKey(ownerPublicKey, type);

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(vaultMap.get(vaultKey.key));

        // TODO this is temporary - it creates zkusd-mina out of thin air
        // add mina to the collateral
        vault.collateralAmount = vault.collateralAmount.add(privateInput.amount);

        return {
          publicOutput: new DepositIntentOutput({
            vaultKey: vaultKey,
            vaultPack: vault.pack(),
          }),
        };
      },
    },
  },
});

export class DepositIntentProof extends ZkProgram.Proof(DepositIntent) {}
