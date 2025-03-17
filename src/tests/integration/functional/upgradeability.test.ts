import { TestHelper, TestAmounts } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import { ZkUsdEngineUpgradeContract } from '../../unit/upgradability/contracts/zkusd-engine-upgrade.js';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
} from '../../../proofs/oracle-price-aggregation/prove.js';
import {
  AccountUpdate,
  Bool,
  Field,
  Poseidon,
  PrivateKey,
  UInt32,
  UInt64,
  VerificationKey,
} from 'o1js';

import { MinaPriceInput } from '../../../proofs/oracle-price-aggregation/verify.js';
import assert from 'node:assert';
import { ContractInstance, KeyPair, WithDefault } from '../../../types/utility.js';
import { OracleWhitelist } from '../../../system/oracle.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import { debugLog } from '../../../utils/debug.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';

describe('zkUSD Upgradability - Engine Upgrade Test Suite', () => {

  let initialEngineState:  Field[];
  let initialCollateral: UInt64;


  let stop: () => void;
  let th: TestHelper<'local' | 'external'>;
  let oneUsdPrice: MinaPriceInput;
  let originalEngineVerificationKey: VerificationKey;
  let upgradedEngineVerificationKey: VerificationKey;
  let upgradedEngine: ContractInstance<
    ReturnType<typeof ZkUsdEngineUpgradeContract>
  >;
  let secret: Field = Field(1234);
  let alice: User;

  type User = {
    keys: KeyPair;
    vault: KeyPair;
  };

  after(async () => {
    // Signal the external worker to stop, if any
    if (stop) stop();
    await th.txMgr.shutdown();
  });

  before(async () => {





    // Prepare a "stopExecutor" promise so we can signal external workers to stop.
    const stopExecutor = new Promise<void>((resolve) => {
      stop = resolve;
    });

    // Determine which transaction executor to use
    const txExecutorInitializers: WithDefault<
      'local' | 'external',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > = {
      local: async () => new LocalTransactionExecutor(),
      external: ExternalTransactionExecutor.initializer({
        prover: new HttpServerProver(),
        stop: stopExecutor,
      }),
      default: 'local', // use external workers by default
    };

    // Init test helper with your chain setup
    th = await TestHelper.initLightnetChain({ txExecutorInitializers });

    //  testing the most basic tx
    const newUser = await th.mina.newAccount();

    await th.mina.fetchMinaAccount(newUser.publicKey, {force: true})

    //  testing the most basic tx
    const newUser2 = await th.mina.newAccount();

    await th.includeTx(newUser, async () => {
      AccountUpdate.createSigned(newUser.publicKey).send(
        { to: newUser2.publicKey,
          amount: 1000000000,
        }
      )}, {name: 'testing the most basic tx'});



    await th.deployTokenContracts({ force: true });
    // await th.deployTokenContracts({ force: false });

    // Verify engine's token account
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );
    assert.ok(engineTokenAccount, 'Engine token account should exist.');

    // Resume protocol if it's emergency stopped
    await th.mina.fetchMinaAccount(th.engine.contract.address, { force: true });
    const stopped = th.engine.contract.isEmergencyStopped().toBoolean();
    if (stopped) {
      debugLog('Protocol is stopped, resuming...');
      await th.includeEngineTx(
        th.deployer,
        {
          transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
          args: {
            transactionId: 'Pre-test resuming the protocol',
            shouldStop: false,
          },
        },
        { extraSigners: [th.networkKeys.protocolAdmin.privateKey] }
      );
      debugLog('Protocol resumed successfully.');
    }

    // create alice

    alice = {
      keys: await th.mina.newAccount(),
      vault: PrivateKey.randomKeypair(),
    }

    // create alice vault
    await th.includeEngineTx(alice.keys, {
      transactionType: ZkusdEngineTransactionType.CREATE_VAULT,
      args: {
        transactionId: 'Create alice vault',
        vaultAddress: alice.vault.publicKey.toBase58(),
        newAccounts: 2
      }
    },
      { extraSigners: [alice.vault.privateKey] }
    );

    oneUsdPrice = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);

    //Alice deposits 200 MINA
    await th.includeEngineTx(
      alice.keys,
      {
        transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
        args: {
          transactionId: 'Alice deposits 200 MINA',
          vaultAddress: alice.vault.publicKey.toBase58(),
          collateralAmount: TestAmounts.COLLATERAL_200_MINA.toBigInt().toString()
        }
      }
    );

    //Alice mints 5 zkUSD
    await th.includeEngineTx(
      alice.keys,
      {
        transactionType: ZkusdEngineTransactionType.MINT_ZKUSD,
        args: {
          transactionId: 'Alice mints 25 zkUSD',
          vaultAddress: alice.vault.publicKey.toBase58(),
          zkusdAmount: TestAmounts.DEBT_5_ZKUSD.add(TestAmounts.DEBT_20_ZKUSD).toBigInt().toString(),
          minaPriceProof: (await th.priceInputMgr.requestProof(TestAmounts.PRICE_1_USD)).proof
        }
      }
    );

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    // --- save the current collateral amount
    initialCollateral = (await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,

      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    ))!.balance;

    if (!engineAccount?.zkapp?.appState) throw new Error('Engine account app state is missing');
    initialEngineState = engineAccount.zkapp.appState;

    originalEngineVerificationKey = engineAccount?.zkapp?.verificationKey!;

    const ZkUsdEngineUpgrade = ZkUsdEngineUpgradeContract({
      zkUsdTokenAddress: th.networkKeys.token.publicKey,
      minaPriceInputZkProgramVkHash: th.oracleAggregationVk.hash,
    });

    const upgradedEngineCompiled = await ZkUsdEngineUpgrade.compile();
    await ZkUsdEngineUpgrade.FungibleToken.compile();

    upgradedEngineVerificationKey = upgradedEngineCompiled.verificationKey;

    upgradedEngine = {
      contract: new ZkUsdEngineUpgrade(th.networkKeys.engine.publicKey),
    };
  });
  // it('// should fail to execute a method on the upgraded engine before the vk is updated', async () => {});
  it('// should fail to execute a method on the upgraded engine before the vk is updated', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        await upgradedEngine.contract.canChangeAdmin(
          th.networkKeys.protocolAdmin.publicKey
        );
      },
      {
        name: 'Upgradability Test Suite: Alice attempts to call a method on the upgraded engine before the vk is updated',
      }
    );
  },
  );

  // it('// should fail to execute a method on the upgraded engine before the vk is updated', async () => {
  //   await assert.rejects(
  //     async () => {
  //       await th.includeTx(
  //         alice.keys,
  //         async () => {
  //           await upgradedEngine.contract.canChangeAdmin(
  //             th.networkKeys.protocolAdmin.publicKey
  //           );
  //         },
  //         {
  //           name: 'Upgradability Test Suite: Alice attempts to call a method on the upgraded engine before the vk is updated',
  //         }
  //       );
  //     },
  //     (err: any) => {
  //       assert.match(err.message, /Invalid proof for account update/i);
  //       return true;
  //     }
  //   );
  // });

  it('should fail to upgrade the engine without the correct signature', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          alice.keys,
          async () => {
            const au = AccountUpdate.create(th.networkKeys.engine.publicKey);

            au.body.update.verificationKey = {
              isSome: Bool(true),
              value: upgradedEngineVerificationKey,
            };
          },
          {
            name: 'Upgradability Test Suite: Alice attempts to upgrade the engine without the correct signature',
          }
        );
      },
      (err: any) => {
        assert.match(
          err.message,
          /Update_not_permitted_verification_key/i
        );
        return true;
      }
    );
  });

  it('should maintain the current state of the engine before the upgrade', async () => {

    debugLog('Test: it should maintain the current state of the engine after the upgrade')
    const engineTrackingAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,

      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );

    const expectedCollateral = initialCollateral;

    debugLog('Asserting collateral amount on the engine tracking account...')
    assert.deepStrictEqual(engineTrackingAccount?.balance, expectedCollateral);
    debugLog('Collateral on the engine tracking account as expected')

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    debugLog('Asserting app state on the engine account... ')
    assert.deepStrictEqual(engineAccount?.zkapp?.appState, initialEngineState);
    debugLog('App state on the engine account as expected')
  });

  it('should allow the engine vk to be updated with the correct signature', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        const au = AccountUpdate.createSigned(th.networkKeys.engine.publicKey);

        au.body.update.verificationKey = {
          isSome: Bool(true),
          value: upgradedEngineVerificationKey,
        };
      },
      {
        name: 'Upgradability Test Suite: Alice upgrades the engine with the correct signature',
        extraSigners: [th.networkKeys.engine.privateKey],
      }
    );

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    assert.deepStrictEqual(
      engineAccount?.zkapp?.verificationKey,
      upgradedEngineVerificationKey
    );
  });

  it('should maintain the current state of the engine after the upgrade', async () => {

    debugLog('Test: it should maintain the current state of the engine after the upgrade')
    const engineTrackingAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,

      {
        tokenId: th.engine.contract.deriveTokenId(),
        force: true,
      }
    );

    const expectedCollateral = initialCollateral;

    debugLog('Asserting collateral amount on the engine tracking account...')
    assert.deepStrictEqual(engineTrackingAccount?.balance, expectedCollateral);
    debugLog('Collateral on the engine tracking account as expected')

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    debugLog('Asserting app state on the engine account... ')
    assert.deepStrictEqual(engineAccount?.zkapp?.appState, initialEngineState);
    debugLog('App state on the engine account as expected')
  });

  it('should fail to call a method on the original engine after the upgrade', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        await th.engine.contract.mintZkUsd(
          alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          oneUsdPrice
        );
      },
      {
        name: 'Upgradability Test Suite: Alice attempts to mint 5 zkUSD on the original engine after the upgrade',
      }
    );
  });

  it('should allow the initialization of the upgraded engine', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        await upgradedEngine.contract.initialize(
          secret,
          th.whitelist,
          UInt32.from(25)
        );
      },
      {
        name: 'Upgradability Test Suite: Alice initializes the upgraded engine',
      }
    );

    console;

    const engineAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        force: true,
      }
    );

    const expectedZkAppState = [
      OracleWhitelist.hash(th.whitelist),
      UInt32.from(25).toFields()[0],
      Poseidon.hash([secret]),
      Bool(false).toField(),
      Bool(false).toField(),
      Field(0),
      Field(0),
      Field(0),
    ];

    assert.deepStrictEqual(engineAccount?.zkapp?.appState, expectedZkAppState);
  });

  it('should allow us to call a method on the upgraded engine', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        await upgradedEngine.contract.mintZkUsd(
          alice.vault!.publicKey,
          TestAmounts.DEBT_5_ZKUSD,
          oneUsdPrice
        );
      },
      {
        name: 'Upgradability Test Suite: Alice mints 5 zkUSD on the upgraded engine',
      }
    );

    const aliceTokenBalance = await th.token.contract.getBalanceOf(
      alice.keys.publicKey
    );

    //We already minted 5 zkUSD on the original engine, so we should have 10 zkUSD now
    assert.deepStrictEqual(aliceTokenBalance, TestAmounts.DEBT_10_ZKUSD);
  });

  it('should allow us to perform admin actions on the upgraded engine with the secret', async () => {
    await th.includeTx(
      alice.keys,
      async () => {
        await upgradedEngine.contract.toggleEmergencyStop(Bool(true), secret);
      },
      {
        name: 'Upgradability Test Suite: Alice toggles the emergency stop on the upgraded engine',
      }
    );

    const isStopped = await upgradedEngine.contract.emergencyStop.fetch();

    assert.deepStrictEqual(isStopped, Bool(true));
  });
});
