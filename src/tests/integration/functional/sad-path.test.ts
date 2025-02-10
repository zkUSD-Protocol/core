import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { AccountUpdate, fetchLastBlock, PrivateKey, UInt64 } from 'o1js';
import { AgentKeys } from '../../../config/keys.js';
import { ZkUsdEngineErrors } from '../../../types/engine.js';
import { VaultErrors } from '../../../types/vault.js';

describe('zkUSD Integration - Functional - Sad Path Test Suite', () => {
  let th: TestHelper<'local'>;

  before(async () => {
    th = await TestHelper.initLightnetChain();
    await th.setupLightnet();
  });

  it('should fail to perform protocol actions when the protocol is stopped', async () => {
    await th.stopTheProtocol();

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_5_ZKUSD,
            await th.getMinaPriceInput(TestAmounts.PRICE_1_USD)
          );
        },
        { name: 'Sad Path Test Suite: Mint while protocol stopped' }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.redeemCollateral(
            th.agents.alice.vault!.publicKey,
            TestAmounts.COLLATERAL_1_MINA,
            await th.getMinaPriceInput(TestAmounts.PRICE_1_USD)
          );
        },
        { name: 'Sad Path Test Suite: Redeem while protocol stopped' }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.liquidate(
            th.agents.bob.vault!.publicKey,
            await th.getMinaPriceInput(TestAmounts.PRICE_25_CENT)
          );
        },
        { name: 'Sad Path Test Suite: Liquidate while protocol stopped' }
      );
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));

    await th.resumeTheProtocol();
  });

  it('should fail to perform price actions when the price is not valid', async () => {
    const currentBlock = (await fetchLastBlock()).blockchainLength;
    if (currentBlock.toBigint() < 15) {
      throw new Error('Current block is too low');
    }

    const expiredBlock = currentBlock.sub(15);

    const expiredPrice = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD, {
      blockHeight: expiredBlock,
    });

    console.log('Price expired, trying to mint');

    await assert.rejects(async () => {
      await th.includeTx(
        th.agents.alice.keys,
        async () => {
          await th.engine.contract.mintZkUsd(
            th.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_1_ZKUSD,
            expiredPrice
          );
        },
        { name: 'Sad Path Test Suite: Mint with expired price' }
      );
    }, /Protocol_state_precondition_unsatisfied/i);
  });

  it('should fail to mint when the health factor is too low', async () => {
    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_100_ZKUSD, // Attempting to mint far too much
              await th.getMinaPriceInput(TestAmounts.PRICE_1_USD)
            );
          },
          { name: 'Sad Path Test Suite: Mint beyond collateral ratio' }
        );
      },
      (err: any) => {
        return err.message.includes(VaultErrors.HEALTH_FACTOR_TOO_LOW);
      }
    );
  });

  it('should fail to redeem more collateral than available', async () => {
    const vaultState = await th.retrieveAgentVaultState('alice');
    const tooMuchCollateral = vaultState.collateralAmount.add(UInt64.from(1e9));

    await assert.rejects(
      async () => {
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.redeemCollateral(
              th.agents.alice.vault!.publicKey,
              tooMuchCollateral,
              await th.getMinaPriceInput(TestAmounts.PRICE_1_USD)
            );
          },
          { name: 'Sad Path Test Suite: Redeem too much collateral' }
        );
      },
      (err: any) => {
        return err.message.includes(VaultErrors.INSUFFICIENT_COLLATERAL);
      }
    );
  });
});
