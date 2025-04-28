import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { UInt64 } from 'o1js';
import { KeyPair, WithDefault } from '../../../types/utility.js';
import { ITransactionExecutor } from '../../../transaction/executor.js';
import { ExternalTransactionExecutor } from '../../../transaction/external-executor.js';
import { HttpClientProver } from '../../../provers/httpclientprover.js';
import { IMinaNetworkInterface } from '../../../mina/network-interface.js';
import { LocalTransactionExecutor } from '../../../transaction/local-executor.js';
import { transaction } from 'o1js/dist/node/lib/mina/transaction.js';
import { ZkusdEngineTransactionType } from '../../../system/transaction.js';

describe('zkUSD Integration - Functional - Happy Path Vault Path + Engine Updates', () => {
  let th: TestHelper<'external'>;
  let startingFee: UInt64 = UInt64.from(1e8);
  let stop: () => void;

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
        // prover: new HttpServerProver(),
        prover: new HttpClientProver('http://localhost:3969'),
        stop: stopExecutor,
      }),
      default: 'external', // use workers by default
    };

    th = await TestHelper.initLightnetChain({ txExecutorInitializers });

    await th.setupLightnet();
  });

  after(async () => {
    stop();
  });

  it('should have deployed the contracts', async () => {
    const engineTokenAccount = await th.mina.fetchMinaAccount(
      th.networkKeys.engine.publicKey,
      {
        tokenId: th.engine.contract.deriveTokenId(),
      }
    );
    assert.notStrictEqual(engineTokenAccount, undefined);
  });

  it('should have created the vaults', async () => {
    const aliceVault = await th.retrieveAgentVaultState('alice');

    assert.deepStrictEqual(aliceVault.owner, th.agents.alice.keys.publicKey);
  });

  it('should have deposited collateral', async () => {
    const aliceVault = await th.retrieveAgentVaultState('alice');

    assert(aliceVault.collateralAmount.toBigInt() > 0n);
  });

  it('should should have minted zkusd ', async () => {
    const aliceZkUsdAccount = await th.mina.fetchMinaAccount(
      th.agents.alice.keys!.publicKey,
      { tokenId: th.token.contract.deriveTokenId(), force: true }
    );

    assert(aliceZkUsdAccount?.balance.toBigInt()! > 0n);
  });

  it('should allow repaying debt ', async () => {
    const aliceVaultBefore = await th.retrieveAgentVaultState('alice');

    const aliceZkUsdAccountBefore = await th.mina.fetchMinaAccount(
      th.agents.alice.keys!.publicKey,
      { tokenId: th.token.contract.deriveTokenId(), force: true }
    );

    await th.includeEngineTx(th.agents.alice.keys, {
      transactionType: ZkusdEngineTransactionType.BURN_ZKUSD,
      args: {
        transactionId: 'Burning 1 zkUSD for alice',
        vaultAddress: th.agents.alice.vault!.publicKey.toBase58(),
        zkusdAmount: TestAmounts.DEBT_1_ZKUSD.toString(),
      },
    });

    const aliceVaultAfter = await th.retrieveAgentVaultState('alice');

    const aliceZkUsdAccountAfter = await th.mina.fetchMinaAccount(
      th.agents.alice.keys!.publicKey,
      { tokenId: th.token.contract.deriveTokenId(), force: true }
    );

    assert.deepStrictEqual(
      aliceVaultAfter.debtAmount,
      aliceVaultBefore.debtAmount.sub(TestAmounts.DEBT_1_ZKUSD)
    );

    assert.deepStrictEqual(
      aliceZkUsdAccountAfter?.balance.toBigInt(),
      aliceZkUsdAccountBefore?.balance.toBigInt()! -
        TestAmounts.DEBT_1_ZKUSD.toBigInt()
    );

    // Verify burn event was emitted
    const events = await th.engine.contract.fetchEvents();
    const burnEvent = events.find((e) => e.type === 'BurnZkUsd');
    assert(burnEvent, 'Burn event should be emitted');
  });

  it('should allow liquidation of an undercollateralised vault', async () => {
    // Get initial states
    const charlieBalanceBefore = await th.mina.fetchMinaAccount(
      th.agents.charlie.keys.publicKey
    );
    const charlieZkUsdBefore = await th.mina.fetchMinaAccount(
      th.agents.charlie.keys.publicKey,
      { tokenId: th.token.contract.deriveTokenId() }
    );

    // Set price very low to trigger liquidation
    const lowPrice = await th.getMinaPriceInput(
      UInt64.from(TestAmounts.DEBT_10_CENT_ZKUSD)
    ); // $0.10

    await th.includeEngineTx(th.agents.charlie.keys, {
      transactionType: ZkusdEngineTransactionType.LIQUIDATE,
      args: {
        transactionId: 'Liquidating bobs vault',
        vaultAddress: th.agents.bob.vault!.publicKey.toBase58(),
        minaPriceProof: lowPrice.proof.toJSON(),
      },
    });

    // Check post-liquidation states

    const bobVaultAfter = await th.retrieveAgentVaultState('bob');

    const charlieBalanceAfter = await th.mina.fetchMinaAccount(
      th.agents.charlie.keys.publicKey
    );

    const charlieZkUsdAfter = await th.mina.fetchMinaAccount(
      th.agents.charlie.keys.publicKey,
      { tokenId: th.token.contract.deriveTokenId() }
    );

    // Verify vault was liquidated
    assert.deepStrictEqual(bobVaultAfter.collateralAmount.toBigInt(), 0n);
    assert.deepStrictEqual(bobVaultAfter.debtAmount.toBigInt(), 0n);

    // Verify Bob paid the debt and received collateral
    assert(
      charlieZkUsdAfter!.balance.toBigInt() <
        charlieZkUsdBefore!.balance.toBigInt()
    );
    assert(
      charlieBalanceAfter!.balance.toBigInt() >
        charlieBalanceBefore!.balance.toBigInt()
    );

    // Verify liquidation event was emitted
    const events = await th.engine.contract.fetchEvents();
    const liquidationEvent = events.find((e) => e.type === 'Liquidate');
    assert(liquidationEvent, 'Liquidation event should be emitted');
  });
});
