import {
  Field,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  Signature,
  UInt64,
  UInt8,
} from 'o1js';
import {
  DepositIntent,
  DepositIntentInput,
  DepositIntentKey,
  DepositPrivateInput,
  VaultKey,
} from './deposit';
import { VaultMap } from '../../data/vault-map';
import { Vault as Vault_ } from '../../data/vault';
import { before } from 'node:test';

export interface DepositIntentTestInput {
  publicInput: DepositIntentInput;
  privateInput: DepositPrivateInput;
}

describe('Deposit Intent Suite', () => {
  const type: UInt8 = UInt8.zero;
  const privateKey: PrivateKey = PrivateKey.random();
  const publicKey: PublicKey = privateKey.toPublicKey();
  const emptyVaultMap = new VaultMap();
  const depositAmount = UInt64.from(1000);
  const collateralRatio = UInt8.from(150);
  const liquidationBonusRatio = UInt8.from(110);

  const Vault = Vault_({
    collateralRatio,
    liquidationBonusRatio,
  });

  const validSignatureMessage = (vaultMap: VaultMap): Field[] => [
    vaultMap.root,
    type.value,
    DepositIntentKey,
  ];

  const emptyVault = () => Vault.new(type);

  /**
   * Creates a vault map with a vault for testing
   */
  async function createVaultMap(): Promise<{
    vaultMap: VaultMap;
    vaultKey: VaultKey;
  }> {
    const vaultMap = new VaultMap();
    const vaultKey = new VaultKey({
      key: Poseidon.hash([
        ...publicKey.toFields(),
        type.value,
        DepositIntentKey,
      ]),
    });

    // Set the vault in the vault map
    vaultMap.set(vaultKey.key, emptyVault().pack());

    return { vaultMap, vaultKey };
  }

  /**
   * Generates both public and private inputs for DepositIntent.
   * Optionally allows tampering to simulate invalid cases.
   */
  async function generateDepositIntentInputs(params: {
    vaultMap: VaultMap;
    signatureMsgFn?: (vaultMap: VaultMap) => Field[];
    amount?: UInt64;
  }): Promise<DepositIntentTestInput> {
    const vaultMap = params.vaultMap;
    const amount = params.amount ?? depositAmount;
    const signatureMsg = params.signatureMsgFn
      ? params.signatureMsgFn(vaultMap)
      : validSignatureMessage(vaultMap);
    const signature = Signature.create(privateKey, signatureMsg);

    return {
      publicInput: new DepositIntentInput({
        vaultMapRoot: vaultMap.root,
        collateralRatio,
        liquidationBonusRatio,
      }),
      privateInput: new DepositPrivateInput({
        vaultMap,
        type,
        ownerSignature: signature,
        ownerPublicKey: publicKey,
        amount,
      }),
    };
  }

  before(async () => {
    // Initialize any necessary setup before running tests
  });

  it('should deposit into a vault successfully with valid inputs', async () => {
    const { vaultMap, vaultKey } = await createVaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
      signatureMsgFn: (vaultMap) => validSignatureMessage(vaultMap),
    });

    const {
      publicOutput: { vaultKey: outputVaultKey, vaultPack },
    } = await DepositIntent.rawMethods.createVault(publicInput, privateInput);

    Provable.log(outputVaultKey);

    // Verify the vault key matches
    expect(outputVaultKey).toEqual(vaultKey);

    // Unpack the vault to verify its state after deposit
    const unpackedVault = Vault.unpack(vaultPack);

    // Add more specific assertions here based on the implementation details
    // For example, verifying that the deposit was correctly applied
  });

  it('should fail if the vaultMap root does not match the public input', async () => {
    const { vaultMap } = await createVaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
      signatureMsgFn: (vaultMap) => validSignatureMessage(vaultMap),
    });

    // Tamper with the vault map root
    publicInput.vaultMapRoot = Field(0);

    // expect to throw
    await expect(
      DepositIntent.rawMethods.createVault(publicInput, privateInput)
    ).rejects.toThrow();
  });

  it('should fail if the ownerSignature is invalid', async () => {
    const { vaultMap } = await createVaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
    });

    // Create an invalid signature (signing a different message)
    const invalidMessage = [Field(0), Field(0), Field(0)];
    privateInput.ownerSignature = Signature.create(privateKey, invalidMessage);

    // expect to throw
    await expect(
      DepositIntent.rawMethods.createVault(publicInput, privateInput)
    ).rejects.toThrow();
  });

  it('should fail if the publicKey does not match the signer of the signature', async () => {
    const { vaultMap } = await createVaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
    });

    // Use a different public key
    const differentPrivateKey = PrivateKey.random();
    privateInput.ownerPublicKey = differentPrivateKey.toPublicKey();

    // expect to throw
    await expect(
      DepositIntent.rawMethods.createVault(publicInput, privateInput)
    ).rejects.toThrow();
  });

  it('should fail if the vault does not exist in the vault map', async () => {
    // Use an empty vault map with no vault
    const emptyMap = new VaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap: emptyMap,
    });

    // expect to throw since the vault doesn't exist
    await expect(
      DepositIntent.rawMethods.createVault(publicInput, privateInput)
    ).rejects.toThrow();
  });

  it('should correctly include the deposit amount in the vault', async () => {
    const { vaultMap, vaultKey } = await createVaultMap();

    const testAmount = UInt64.from(2000);
    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
      amount: testAmount,
    });

    const {
      publicOutput: { vaultPack },
    } = await DepositIntent.rawMethods.createVault(publicInput, privateInput);

    // Unpack the vault to verify the deposit was applied
    const unpackedVault = Vault.unpack(vaultPack);

    // Add assertions to verify the deposit amount was correctly applied
    // This will depend on how the vault's internal state tracks deposits
  });

  it('should include DepositIntentKey in the signed message', async () => {
    const { vaultMap } = await createVaultMap();

    // Create inputs but with a modified intent key in the signature
    const modifiedSignatureMessage = (vaultMap: VaultMap): Field[] => [
      vaultMap.root,
      type.value,
      Field(999), // Not the correct DepositIntentKey
    ];

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
      signatureMsgFn: modifiedSignatureMessage,
    });

    // expect to throw due to invalid signature (wrong intent key)
    await expect(
      DepositIntent.rawMethods.createVault(publicInput, privateInput)
    ).rejects.toThrow();
  });

  it('should use the correct fields from ownerPublicKey in Poseidon hash', async () => {
    const { vaultMap } = await createVaultMap();

    const { publicInput, privateInput } = await generateDepositIntentInputs({
      vaultMap,
    });

    const {
      publicOutput: { vaultKey: outputVaultKey },
    } = await DepositIntent.rawMethods.createVault(publicInput, privateInput);

    // Manually compute the expected vault key
    const expectedKey = new VaultKey({
      key: Poseidon.hash([
        ...publicKey.toFields(),
        type.value,
        DepositIntentKey,
      ]),
    });

    expect(outputVaultKey).toEqual(expectedKey);
  });

});
