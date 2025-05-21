import {
  Field,
  Poseidon,
  PublicKey,
  Signature,
  Struct,
  UInt8,
  ZkProgram,
} from 'o1js';
import { VaultMap } from '../../data/vault-map.js';

export class CreateVaultIntentInput extends Struct({
  vaultMapRoot: Field,
}) {}

export class VaultKey extends Struct({
  key: Field,
}) {}

export class CreateVaultIntentOutput extends Struct({
  vaultKey: VaultKey,
  vaultType: UInt8,
}) {}

export class CreateVaultPrivateInput extends Struct({
  vaultMap: VaultMap,
  type: UInt8,
  ownerSignature: Signature,
  ownerPublicKey: PublicKey,
}) {}

// todo: make it better?
export const CreateVaultIntentKey = Field.from('420420001');

export const CreateVaultIntent = ZkProgram({
  name: 'CreateVaultIntent',
  publicInput: CreateVaultIntentInput,
  publicOutput: CreateVaultIntentOutput,
  methods: {
    createVault: {
      privateInputs: [CreateVaultPrivateInput],
      async method(
        publicInput: CreateVaultIntentInput,
        privateInput: CreateVaultPrivateInput
      ): Promise<{ publicOutput: CreateVaultIntentOutput }> {
        const { vaultMapRoot } = publicInput;
        const { type, ownerSignature, ownerPublicKey, vaultMap } = privateInput;

        // validate vault map
        vaultMap.root.assertEquals(vaultMapRoot);

        // signature message
        const message: Field[] = [
          vaultMapRoot,
          type.value,
          CreateVaultIntentKey,
        ];

        // vault key (hiding public key)
        const vaultKey: VaultKey = new VaultKey({
          key: Poseidon.hash([
            ...ownerPublicKey.toFields(),
            type.value,
            CreateVaultIntentKey,
          ]),
        });

        // Validate the owner's signature
        const isValidSignature = ownerSignature.verify(ownerPublicKey, message);
        if (!isValidSignature) throw new Error('Invalid signature');

        return {
          publicOutput: new CreateVaultIntentOutput({
            vaultKey,
            vaultType: type,
          }),
        };
      },
    },
  },
});

// Create proof types for our intent programs
export class CreateVaultIntentProof extends ZkProgram.Proof(
  CreateVaultIntent
) {}
