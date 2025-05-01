import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Bool, Keypair, PrivateKey, PublicKey } from 'o1js';
import { TransactionHandle } from '../../../transaction/manager.js';
import { KeyPair, WithDefault } from '../../../types/utility.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';
import { HttpClientProver } from '../../../provers/httpclientprover.js';
import { HttpServerProver } from '../../../provers/node/httpserverprover.js';
import { ProtocolData } from '../../../system/engine.js';
import { EngineUpdateOperation } from '../../../system/engine-update/operation.js';
import { BoolOperation } from '../../../system/engine-update/simple-operations.js';

const printTx = !!process.env.DEBUG;

describe('zkUSD Integration - Concurrent Functional - Happy Path Vault Path', () => {
  let th: TestHelper<'local' | 'external'>;
  let mike: {
    mintedHandle: TransactionHandle;
    keys: KeyPair;
    vault: KeyPair;
  };
  let resumed: TransactionHandle | undefined;
  let stop: () => void;

  let newman: KeyPair;
  let newmanVault: KeyPair;

  before(async () => {
    const stopExecutor = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const txExecutorInitializers: WithDefault<
      'local' | 'external',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > = {
      local: async () => new LocalTransactionExecutor(),
      external: ExternalTransactionExecutor.initializer({
        prover: new HttpServerProver(),
        // prover: new HttpClientProver('http://188.245.244.23:3969'),
        stop: stopExecutor,
      }),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });
  });

  after(async () => {
    stop();
  });

  const ensureProtocolResume = async () => {
    const protocolDataPacked =
      await th.engine.contract.protocolDataPacked.fetch();

    const protocolData = ProtocolData.unpack(protocolDataPacked!);

    const emergencyStopFlag = protocolData.emergencyStop;

    if (emergencyStopFlag.toBoolean()) {
      resumed = await th.proposeAndExecuteUpdate(
        EngineUpdateOperation.create({
          emergencyStop: BoolOperation.set(false),
        }),
        (updateSpec, resolutionWitness) =>
          th.engine.contract.govToggleEmergencyStop(
            updateSpec,
            resolutionWitness
          ),
        {
          returnTxHandle: true,
        }
      );
    }
  };

  const makeMike = async () => {
    console.log('Making Mike');

    const mike = await th.mina.newAccount();
    const mikeVault = PrivateKey.randomKeypair();

    // create vault for mike
    const mcv = await th.engineTx(
      mike,
      {
        transactionType: ZkusdEngineTransactionType.CREATE_VAULT,
        args: {
          transactionId: `Mike creates a vault`,
          newAccounts: 2,
          vaultAddress: mikeVault.publicKey.toBase58(),
        },
      },
      { printTx, extraSigners: [mikeVault.privateKey] }
    );

    // mike deposit
    const mdc = await th.engineTx(
      mike,
      {
        transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
        args: {
          transactionId: `Mike deposits collateral`,
          vaultAddress: mikeVault.publicKey.toBase58(),
          collateralAmount: TestAmounts.COLLATERAL_100_MINA.toString(),
        },
      },
      { printTx, waitForIncluded: [mcv] }
    );

    const minaPriceProof = (
      await th.priceInputMgr.requestProof(TestAmounts.PRICE_1_USD)
    ).proof;
    // mike mints
    const mmz = await th.engineTx(
      mike,
      {
        transactionType: ZkusdEngineTransactionType.MINT_ZKUSD,
        args: {
          transactionId: `Mike mints zkusd`,
          vaultAddress: mikeVault.publicKey.toBase58(),
          zkusdAmount: TestAmounts.DEBT_50_ZKUSD.toString(),
          minaPriceProof,
        },
      },
      { printTx, waitForIncluded: resumed ? [mdc, resumed] : [mdc] }
    );

    return {
      mintedHandle: mmz,
      keys: mike,
      vault: mikeVault,
    };
  };
  it('should have deployed the contracts', async () => {
    await th.deployTokenContracts();
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
      }
    );
    assert.notStrictEqual(engineTokenAccount, undefined);
  });

  it('should ensure protocol resumed without waiting', async () => {
    await ensureProtocolResume();
  });

  it('should start protocol updates testing without waiting', async () => {
    const current = th.engine.contract.getAdmin();
    const old = th.networkKeys.protocolAdmin;

    assert.ok(old.publicKey.equals(current), 'unknown current admin!');

    // extraSigners: [th.networkKeys.protocolAdmin.privateKey],

    // const newAdminTxHandle = th.engineTx(sender, args)

    await ensureProtocolResume();
  });

  it('should schedule making mike transactioncs without waiting', async () => {
    mike = await makeMike();
    assert(mike.mintedHandle, 'Mike minted handle should be defined');
  });

  it('should have created the vaults', async () => {
    // create a new actor
    newman = await th.mina.newAccount();
    newmanVault = PrivateKey.randomKeypair();

    // create vault for newman
    await th.includeEngineTx(
      newman,
      {
        transactionType: ZkusdEngineTransactionType.CREATE_VAULT,
        args: {
          transactionId: `Newman creates a vault`,
          newAccounts: 2,
          vaultAddress: newmanVault.publicKey.toBase58(),
        },
      },
      { printTx, extraSigners: [newmanVault.privateKey] }
    );

    const vaultState = await th.retrieveVaultState(newmanVault.publicKey);
    // assert defined
    assert.notStrictEqual(vaultState, undefined);
    assert.deepStrictEqual(vaultState?.owner, newman.publicKey);
    assert.deepStrictEqual(vaultState?.collateralAmount.toBigInt(), 0n);
    assert.deepStrictEqual(vaultState?.debtAmount.toBigInt(), 0n);
  });

  it('should have deposited collateral', async () => {
    // deposit
    await th.includeEngineTx(
      newman,
      {
        transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
        args: {
          transactionId: `Newman deposits collateral`,
          vaultAddress: newmanVault.publicKey.toBase58(),
          collateralAmount: TestAmounts.COLLATERAL_100_MINA.toString(),
        },
      },
      { printTx }
    );

    const vaultState = await th.retrieveVaultState(newmanVault.publicKey);
    // assert defined
    assert.notStrictEqual(vaultState, undefined);
    assert.deepStrictEqual(vaultState?.owner, newman.publicKey);
    assert.ok(
      vaultState?.collateralAmount.equals(TestAmounts.COLLATERAL_100_MINA)
    );
    assert.deepStrictEqual(vaultState?.debtAmount.toBigInt(), 0n);
  });

  it('should should have minted zkusd ', async () => {
    const minaPriceProof = (
      await th.priceInputMgr.requestProof(TestAmounts.PRICE_1_USD)
    ).proof;
    // deposit
    await th.includeEngineTx(
      newman,
      {
        transactionType: ZkusdEngineTransactionType.MINT_ZKUSD,
        args: {
          transactionId: `Newman mints zkusd`,
          vaultAddress: newmanVault.publicKey.toBase58(),
          zkusdAmount: TestAmounts.DEBT_50_ZKUSD.toString(),
          minaPriceProof,
        },
      },
      { printTx, waitForIncluded: resumed ? [resumed] : [] }
    );

    const vaultState = await th.retrieveVaultState(newmanVault.publicKey);
    // assert defined
    assert.notStrictEqual(vaultState, undefined);
    assert.deepStrictEqual(vaultState?.owner, newman.publicKey);
    assert.ok(
      vaultState?.collateralAmount.lessThan(TestAmounts.COLLATERAL_100_MINA)
    );
    assert.ok(vaultState?.debtAmount.equals(TestAmounts.DEBT_50_ZKUSD));

    // Verify mint event was emitted
    const events = await th.engine.contract.fetchEvents();
    const mintEvent = events.find((e) => e.type === 'MintZkUsd');
    assert(mintEvent, 'Mint event should be emitted');
  });

  it('should should have repaid the debt (burn)', async () => {
    const newmanVaultBefore = await th.retrieveVaultState(
      newmanVault.publicKey
    );
    const newmanZkusdAccountBefore = await th.mina.fetchMinaAccount(
      newman.publicKey,
      { tokenId: th.token.contract.deriveTokenId(), force: true }
    );

    // burn
    await th.includeEngineTx(
      newman,
      {
        transactionType: ZkusdEngineTransactionType.BURN_ZKUSD,
        args: {
          transactionId: `Newman burns zkusd`,
          vaultAddress: newmanVault.publicKey.toBase58(),
          zkusdAmount: TestAmounts.DEBT_10_ZKUSD.toString(),
        },
      },
      { printTx }
    );

    const newmanVaultAfter = await th.retrieveVaultState(newmanVault.publicKey);
    const newmanZkusdAccountAfter = await th.mina.fetchMinaAccount(
      newman.publicKey,
      { tokenId: th.token.contract.deriveTokenId(), force: true }
    );

    assert.deepStrictEqual(
      newmanVaultAfter?.debtAmount,
      newmanVaultBefore?.debtAmount.sub(TestAmounts.DEBT_10_ZKUSD)
    );

    assert.deepStrictEqual(
      newmanZkusdAccountAfter?.balance.toBigInt(),
      newmanZkusdAccountBefore?.balance.toBigInt()! -
        TestAmounts.DEBT_10_ZKUSD.toBigInt()
    );

    // Verify burn event was emitted
    const events = await th.engine.contract.fetchEvents();
    const burnEvent = events.find((e) => e.type === 'BurnZkUsd');
    assert(burnEvent, 'Burn event should be emitted');
  });

  it('should allow liquidation of an undercollateralised vault', async () => {
    // get the lower price
    const lowPriceProof = (
      await th.priceInputMgr.requestProof(TestAmounts.PRICE_25_CENT)
    ).proof;

    const newmanBalanceBefore = await th.mina.fetchMinaAccount(
      newman.publicKey
    );
    const newmanZkUsdBefore = await th.mina.fetchMinaAccount(newman.publicKey, {
      tokenId: th.token.contract.deriveTokenId(),
    });

    const mikeBalanceBefore = await th.mina.fetchMinaAccount(
      mike.keys.publicKey
    );
    const mikeZkUsdBefore = await th.mina.fetchMinaAccount(
      mike.keys.publicKey,
      {
        tokenId: th.token.contract.deriveTokenId(),
      }
    );

    if (!mike) {
      throw new Error('There was an error initializing Mike');
    }

    // mike's be liquidated
    await th.includeEngineTx(
      mike.keys,
      {
        transactionType: ZkusdEngineTransactionType.LIQUIDATE,
        args: {
          transactionId: `Mike is liquidated by newman`,
          vaultAddress: mike.vault.publicKey.toBase58(),
          minaPriceProof: lowPriceProof,
        },
      },
      { printTx, waitForIncluded: [mike.mintedHandle] }
    );

    // Get initial states
    const newmanBalanceAfter = await th.mina.fetchMinaAccount(newman.publicKey);
    const newmanZkUsdAfter = await th.mina.fetchMinaAccount(newman.publicKey, {
      tokenId: th.token.contract.deriveTokenId(),
    });

    // Get initial states
    const mikeBalanceAfter = await th.mina.fetchMinaAccount(
      mike.keys.publicKey
    );
    const mikeZkUsdAfter = await th.mina.fetchMinaAccount(mike.keys.publicKey, {
      tokenId: th.token.contract.deriveTokenId(),
    });

    // newman balance higher - he got the collateral
    assert.ok(
      newmanBalanceAfter?.balance.greaterThan(newmanBalanceBefore!.balance)
    );

    // mike balance higher - he also got part of the collateral
    assert.ok(
      mikeBalanceAfter?.balance.greaterThan(mikeBalanceBefore!.balance)
    );

    // newman zkusd lower - he has repaid
    assert.ok(newmanZkUsdAfter?.balance.lessThan(newmanZkUsdBefore!.balance));

    // mike zkusd unchanged - no debt, but not collateral :(
    assert.ok(mikeZkUsdAfter?.balance.equals(mikeZkUsdBefore!.balance));

    // // Verify liquidation event was emitted
    const events = await th.engine.contract.fetchEvents();
    const liquidationEvent = events.find((e) => e.type === 'Liquidate');
    assert(liquidationEvent, 'Liquidation event should be emitted');
  });
});
