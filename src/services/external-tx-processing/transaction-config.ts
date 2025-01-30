import { FungibleTokenContract } from '@minatokens/token';
import { ZkUsdEngineContract } from '../../contracts/zkusd-engine.js';
import { MinaPriceInput } from '../../proofs/oracle-price-aggregation';
import {
  CollateralAmountAndPriceProofArgs,
  CollateralAmountArgs,
  CreateVaultArgs,
  PriceProofArgs,
  VaultTransactionArgs,
  VaultTransactionType,
  ZkUSDAmountAndPriceProofArgs,
  ZkUSDAmountArgs,
} from '../../types/cloud-worker.js';
import { PublicKey, UInt64 } from 'o1js';

export {
  ZkUsdEngine,
  FungibleToken,
  TransactionConfig,
  mkVaultTransactionConfigs,
};

type ZkUsdEngine = ReturnType<typeof ZkUsdEngineContract>;
type FungibleToken = ReturnType<typeof FungibleTokenContract>;

interface TransactionConfig<T extends VaultTransactionType> {
  method: T;
  buildTx: (
    args: VaultTransactionArgs[T],
    minaPriceInput?: MinaPriceInput
  ) => Promise<void>;
  requiresNewAccounts?: boolean;
  requiresPriceProof?: boolean;
}

/**
 * Configuration map for different vault transaction types.
 * Each configuration defines:
 * - method: The transaction type
 * - buildTx: Function to construct the transaction
 * - requiresNewAccounts: Whether new accounts need to be created
 * - requiresPriceProof: Whether a price proof is needed for the operation
 */
function mkVaultTransactionConfigs(engine: InstanceType<ZkUsdEngine>): {
  [K in VaultTransactionType]: TransactionConfig<K>;
} {
  return {
    [VaultTransactionType.CREATE_VAULT]: {
      method: VaultTransactionType.CREATE_VAULT,
      buildTx: async (args: CreateVaultArgs) => {
        await engine.createVault(PublicKey.fromBase58(args.vaultAddress));
      },
      requiresNewAccounts: true,
    },

    [VaultTransactionType.DEPOSIT_COLLATERAL]: {
      method: VaultTransactionType.DEPOSIT_COLLATERAL,
      buildTx: async (args: CollateralAmountArgs) => {
        await engine.depositCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.collateralAmount)
        );
      },
    },

    [VaultTransactionType.REDEEM_COLLATERAL]: {
      method: VaultTransactionType.REDEEM_COLLATERAL,
      buildTx: async (
        args: CollateralAmountAndPriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await engine.redeemCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.collateralAmount),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },

    [VaultTransactionType.BURN_ZKUSD]: {
      method: VaultTransactionType.BURN_ZKUSD,
      buildTx: async (args: ZkUSDAmountArgs) => {
        await engine.burnZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.zkusdAmount)
        );
      },
    },

    [VaultTransactionType.MINT_ZKUSD]: {
      method: VaultTransactionType.MINT_ZKUSD,
      buildTx: async (
        args: ZkUSDAmountAndPriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await engine.mintZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.zkusdAmount),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },

    [VaultTransactionType.LIQUIDATE]: {
      method: VaultTransactionType.LIQUIDATE,
      buildTx: async (
        args: PriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await engine.liquidate(
          PublicKey.fromBase58(args.vaultAddress),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },
  };
}
