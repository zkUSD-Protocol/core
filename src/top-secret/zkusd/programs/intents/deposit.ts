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
import { VaultMap } from '../../data/vault-map';
import { Vault } from '../../data/vault';

export class DepositIntentInput extends Struct({
  vaultMapRoot: Field,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {}

export class VaultKey extends Struct({
  key: Field,
}) {}

export class DepositIntentOutput extends Struct({
  vaultKey: VaultKey,
  vaultPack: Field
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
    createVault: {
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
        const message: Field[] = [
          vaultMapRoot,
          type.value,
          DepositIntentKey,
        ];

        // Validate the owner's signature
        const isValidSignature = ownerSignature.verify(ownerPublicKey, message);
        isValidSignature.assertTrue('Invalid signature');

        // vault key (hiding public key)
        const vaultKey: VaultKey = new VaultKey({
          key: Poseidon.hash([
            ...ownerPublicKey.toFields(),
            type.value,
            DepositIntentKey,
          ]),
        });

        //Get the vault
        const vault = Vault({
          collateralRatio: publicInput.collateralRatio,
          liquidationBonusRatio: publicInput.liquidationBonusRatio,
        }).unpack(vaultMap.get(vaultKey.key));


        return {
          publicOutput: new DepositIntentOutput({
            vaultKey: vaultKey,
            vaultPack: vault.pack()
          }),
        };
      },
    },
  },
});
