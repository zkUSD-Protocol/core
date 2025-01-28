import {
  AccountUpdate,
  Bool,
  PrivateKey,
  VerificationKey,
  method,
  Provable,
  PublicKey,
  SmartContract,
  state,
  State,
  Permissions,
} from 'o1js';
import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import {
  FungibleTokenAdminBase,
  FungibleTokenAdminDeployProps,
  FungibleTokenContract,
} from '@minatokens/token';
import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';

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
  let th: TestHelper;
  const newAdminContract = PrivateKey.randomKeypair();
  const newAdmin = PrivateKey.randomKeypair();
  const adminContract = new NewFungibleTokenAdmin(newAdminContract.publicKey);
  let priceOneUsd: MinaPriceInput;

  before(async () => {
    th = await TestHelper.initLocalChain({ proofsEnabled: false });
    await th.deployTokenContracts();

    await th.createAgents(['alice']);
    await th.createVaults(['alice']);

    priceOneUsd = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    //Alice deposits 100 Mina
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.depositCollateral(
          th.agents.alice.vault!.publicKey,
          TestAmounts.COLLATERAL_100_MINA
        );
      },
      {
        name: 'Token Admin Test Suite: Alice deposits 100 Mina',
      }
    );
    //Alice mints 5 zkUSD
    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          th.agents.alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          priceOneUsd
        );
      },
      {
        name: 'Token Admin Test Suite: Alice mints 5 zkUSD',
      }
    );

    await th.includeTx(
      th.deployer,
      async () => {
        AccountUpdate.fundNewAccount(th.deployer.publicKey, 1);
        await adminContract.deploy({
          adminPublicKey: newAdmin.publicKey,
        });
      },
      {
        extraSigners: [newAdminContract.privateKey],
        name: 'Token Admin Test Suite: Alice creates new admin key',
      }
    );
  });

  it('should not be able to change the admin without the admin signature', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.deployer,
        async () => {
          await th.token.contract.setAdmin(newAdminContract.publicKey);
        },
        {
          name: 'Token Admin Test Suite: Alice attempts to change admin without admin signature',
        }
      );
    }, /Transaction verification failed/i);
  });

  it('should be able to change the admin with the admin signature', async () => {
    await th.includeTx(
      th.deployer,
      async () => {
        await th.token.contract.setAdmin(newAdminContract.publicKey);
      },
      {
        extraSigners: [th.networkKeys.protocolAdmin.privateKey],
        name: 'Token Admin Test Suite: Alice changes admin with admin signature',
      }
    );

    const tokenAdmin = await th.token.contract.admin.fetch();
    assert.deepStrictEqual(tokenAdmin, newAdminContract.publicKey);
  });

  it('should no longer be able to mint from the engine contract', async () => {
    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_5_ZKUSD,
            priceOneUsd
          );
        },
        {
          name: 'Token Admin Test Suite: Alice attempts to mint from engine contract',
        }
      );
    }, /Account_app_state_precondition_unsatisfied/);
  });

  it('should be able to mint from the token contract', async () => {
    const FungibleToken = FungibleTokenContract(NewFungibleTokenAdmin);
    th.token.contract = new FungibleToken(th.networkKeys.token.publicKey);

    await th.token.contract.getBalanceOf(th.agents.alice.keys.publicKey);

    await th.includeTx(
      th.agents.alice.keys,
      async () => {
        AccountUpdate.fundNewAccount(th.agents.alice.keys.publicKey, 1);
        await th.token.contract.mint(
          th.agents.alice.keys.publicKey,
          TestAmounts.DEBT_5_ZKUSD
        );
      },
      {
        extraSigners: [newAdmin.privateKey],
        name: 'Token Admin Test Suite: Alice mints from token contract',
      }
    );
  });
});
