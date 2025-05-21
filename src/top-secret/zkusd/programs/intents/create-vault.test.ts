import {
  Field,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  Signature,
  UInt8,
  ZkProgram,
} from 'o1js';
import {
  CreateVaultIntent,
  CreateVaultIntentInput,
  CreateVaultIntentKey,
  CreateVaultPrivateInput,
  VaultKey,
} from './create-vault.js';
import { VaultMap } from '../../data/vault-map.js';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';


export interface VaultIntentTestInput {
  publicInput: CreateVaultIntentInput;
  privateInput: CreateVaultPrivateInput;
}

describe('Create Vault Intent Suite', () => {
  const type: UInt8 = UInt8.zero;
  const privateKey: PrivateKey = PrivateKey.random();
  const publicKey: PublicKey = privateKey.toPublicKey();
  const emptyVaultMap = new VaultMap();

  const validSignatureMessage = (vaultMap: VaultMap): Field[] => [
    vaultMap.root,
    type.value,
    CreateVaultIntentKey,
  ];

  /**
   * Generates both public and private inputs for CreateVaultIntent.
   * Optionally allows tampering to simulate invalid cases (e.g., signature mismatch, wrong root).
   */
  function generateVaultIntentInputs(params: {
    vaultMap?: VaultMap;
    signatureMsgFn?: (vaultMap: VaultMap) => Field[];
  }): Promise<VaultIntentTestInput> {
    const vaultMap = params.vaultMap ?? new VaultMap();
    const signatureMsg = params.signatureMsgFn
      ? params.signatureMsgFn(vaultMap)
      : validSignatureMessage(vaultMap);
    const signature = Signature.create(privateKey, signatureMsg);
    return Promise.resolve({
      publicInput: new CreateVaultIntentInput({
        vaultMapRoot: emptyVaultMap.root,
      }),
      privateInput: new CreateVaultPrivateInput({
        vaultMap,
        type,
        ownerSignature: signature,
        ownerPublicKey: publicKey,
      }),
    });
  }

  before(async () => {
    // Initialize any necessary setup before running tests
  });
  it('should create a vault successfully with valid inputs', async () => {
    const { publicInput, privateInput } = await generateVaultIntentInputs({
      vaultMap: new VaultMap(),
      signatureMsgFn: (vaultMap) => validSignatureMessage(vaultMap),
    });

    const {
      publicOutput: { vaultKey, vaultType },
    } = await CreateVaultIntent.rawMethods.createVault(
      publicInput,
      privateInput
    );

    Provable.log(vaultKey);

    const expectedKey = new VaultKey({
      key: Poseidon.hash([
        ...publicKey.toFields(),
        type.value,
        CreateVaultIntentKey,
      ]),
    });
    assert.deepEqual(vaultKey, expectedKey);
    assert.deepEqual(vaultType, type);

  });

  it('should fail if the vaultMap root does not match the public input', async () => {
    const { publicInput, privateInput } = await generateVaultIntentInputs({
      vaultMap: new VaultMap(),
      signatureMsgFn: (vaultMap) => validSignatureMessage(vaultMap),
    });

    publicInput.vaultMapRoot = Field(0);

    // expect to throw
    await assert.rejects(async () => {
  await CreateVaultIntent.rawMethods.createVault(publicInput, privateInput);
});

  });

  it('should fail if the ownerSignature is invalid', async () => {
    // Tamper signature or sign wrong message
  });

  it('should fail if the publicKey does not match the signer of the signature', async () => {
    // Use a mismatching publicKey
  });

  it('should correctly derive the vaultKey using Poseidon hash', async () => {
    // Validate output vaultKey is as expected
  });

  it('should include CreateVaultIntentKey in the signed message', async () => {
    // Confirm CreateVaultIntentKey is used in message hash
  });

  it('should use the correct fields from ownerPublicKey in Poseidon hash', async () => {
    // Validate hash inputs
  });

  it('should output the correct vaultType in the public output', async () => {
    // Check that vaultType is correctly passed through
  });
});
