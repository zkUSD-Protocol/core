import { TestAmounts, TestHelper } from '../../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { ZkUsdEngineErrors } from '../../../system/engine.js';
import { UInt64, fetchLastBlock } from 'o1js';
import { VaultErrors } from '../../../system/vault.js';

describe('zkUSD Integration - Functional - Sad Path Test Suite', () => {
  let th: TestHelper<'local'>;

  before(async () => {
    th = await TestHelper.initLightnetChain();
    await th.setupLightnet();
  });

  it('should fail to perform protocol actions when the protocol is stopped', async () => {
    await th.stopTheProtocol();

    await assert.rejects(
      async () => {
        const priceInput = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD,
              priceInput
            );
          },
          { name: 'Sad Path Test Suite: Mint while protocol stopped' }
        );
      },
      (error: any) => error.message.includes(ZkUsdEngineErrors.EMERGENCY_HALT)
    );

    await assert.rejects(
      async () => {
        const priceInput = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.redeemCollateral(
              th.agents.alice.vault!.publicKey,
              TestAmounts.COLLATERAL_1_MINA,
              priceInput
            );
          },
          { name: 'Sad Path Test Suite: Redeem while protocol stopped' }
        );
      },
      (error: any) => error.message.includes(ZkUsdEngineErrors.EMERGENCY_HALT)
    );

    await assert.rejects(
      async () => {
        const priceInput = await th.getMinaPriceInput(
          TestAmounts.PRICE_25_CENT
        );
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.liquidate(
              th.agents.bob.vault!.publicKey,
              priceInput
            );
          },
          { name: 'Sad Path Test Suite: Liquidate while protocol stopped' }
        );
      },
      (error: any) => error.message.includes(ZkUsdEngineErrors.EMERGENCY_HALT)
    );

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

    await assert.rejects(
      async () => {
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
      },
      (error: any) =>
        error.message
          .toLowerCase()
          .includes('protocol_state_precondition_unsatisfied'.toLowerCase())
    );
  });

  it('should fail to mint when the health factor is too low', async () => {
    await assert.rejects(
      async () => {
        const priceInput = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.mintZkUsd(
              th.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_100_ZKUSD, // Attempting to mint far too much
              priceInput
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
        const priceInput = await th.getMinaPriceInput(TestAmounts.PRICE_1_USD);
        await th.includeTx(
          th.agents.alice.keys,
          async () => {
            await th.engine.contract.redeemCollateral(
              th.agents.alice.vault!.publicKey,
              tooMuchCollateral,
              priceInput
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
