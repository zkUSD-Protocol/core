import {
  AccountUpdate,
  Bool,
  PrivateKey,
  VerificationKey,
  Mina,
  method,
  Provable,
  PublicKey,
  SmartContract,
  state,
  State,
  Permissions,
} from 'o1js';
import { TestAmounts, TestHelper } from '../unit-test-helper.js';
import { ProtocolData } from '../../../types.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import {
  FungibleTokenAdminBase,
  FungibleTokenAdminDeployProps,
  FungibleTokenContract,
} from '@minatokens/token';
import { transaction } from '../../../utils/transaction.js';

export class NewFungibleTokenAdmin
  extends SmartContract
  implements FungibleTokenAdminBase
{
  @state(PublicKey)
  private adminPublicKey = State<PublicKey>();

  async deploy(props: FungibleTokenAdminDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  /** Update the verification key.
   * Note that because we have set the permissions for setting the verification key to `impossibleDuringCurrentVersion()`, this will only be possible in case of a protocol update that requires an update.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    this.account.verificationKey.set(vk);
  }

  private async ensureAdminSignature() {
    const admin = await Provable.witnessAsync(PublicKey, async () => {
      let pk = await this.adminPublicKey.fetch();
      assert(pk !== undefined, 'could not fetch admin public key');
      return pk;
    });
    this.adminPublicKey.requireEquals(admin);
    return AccountUpdate.createSigned(admin);
  }

  @method.returns(Bool)
  public async canMint(_accountUpdate: AccountUpdate) {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canChangeAdmin(_admin: PublicKey) {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canPause(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canResume(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }
}

describe('zkUSD Protocol Vault Token Administration Test Suite', () => {
  const testHelper = new TestHelper();
  const newAdminContract = PrivateKey.randomKeypair();
  const newAdmin = PrivateKey.randomKeypair();
  const adminContract = new NewFungibleTokenAdmin(newAdminContract.publicKey);

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();

    testHelper.createAgents(['alice']);
    await testHelper.createVaults(['alice']);

    //Alice deposits 100 Mina
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });
    //Alice mints 5 zkUSD
    await transaction(testHelper.agents.alice.keys, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_5_ZKUSD
      );
    });

    await transaction(
      testHelper.deployer,
      async () => {
        AccountUpdate.fundNewAccount(testHelper.deployer.publicKey, 1);
        await adminContract.deploy({
          adminPublicKey: newAdmin.publicKey,
        });
      },
      {
        extraSigners: [newAdminContract.privateKey],
      }
    );
  });

  it('should not be able to change the admin without the admin signature', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.deployer, async () => {
        await testHelper.token.contract.setAdmin(newAdminContract.publicKey);
      });
    }, /Transaction verification failed/i);
  });

  it('should be able to change the admin with the admin signature', async () => {
    await transaction(
      testHelper.deployer,
      async () => {
        await testHelper.token.contract.setAdmin(newAdminContract.publicKey);
      },
      {
        extraSigners: [testHelper.networkKeys.protocolAdmin.privateKey],
      }
    );

    const tokenAdmin = await testHelper.token.contract.admin.fetch();
    assert.deepStrictEqual(tokenAdmin, newAdminContract.publicKey);
  });

  it('should no longer be able to mint from the engine contract', async () => {
    await assert.rejects(async () => {
      await transaction(testHelper.agents.alice.keys, async () => {
        await testHelper.engine.contract.mintZkUsd(
          testHelper.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD
        );
      });
    }, /Account_app_state_precondition_unsatisfied/);
  });

  it('should be able to mint from the token contract', async () => {
    const FungibleToken = FungibleTokenContract(NewFungibleTokenAdmin);
    testHelper.token.contract = new FungibleToken(
      testHelper.networkKeys.token.publicKey
    );

    const aliceBalance = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.alice.keys.publicKey
    );

    await transaction(
      testHelper.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(testHelper.agents.alice.keys.publicKey, 1);
        await testHelper.token.contract.mint(
          testHelper.agents.alice.keys.publicKey,
          TestAmounts.DEBT_5_ZKUSD
        );
      },
      {
        extraSigners: [newAdmin.privateKey],
      }
    );
  });
});
