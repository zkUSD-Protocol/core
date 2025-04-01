import { FungibleTokenContract } from '@minatokens/token';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import { MinaPriceInput } from '../proofs/oracle-price-aggregation';
import {
  CollateralAmountAndPriceProofArgs,
  CollateralAmountArgs,
  CreateVaultArgs,
  PriceProofArgs,
  ZkusdEngineTransactionType,
  ZkUSDAmountAndPriceProofArgs,
  ZkUSDAmountArgs,
  ZkusdEngineTransactionArgs,
} from './transaction.js';
import { AccountUpdate, Bool, PublicKey, UInt64, UInt8 } from 'o1js';
import { OracleWhitelist } from './oracle.js';

export {
  ZkUsdEngine,
  FungibleToken,
  TransactionConfig,
  mkZkusdTransactionConfigs,
};

type ZkUsdEngine = ReturnType<typeof ZkUsdEngineContract>;
type FungibleToken = ReturnType<typeof FungibleTokenContract>;

interface TransactionConfig<T extends ZkusdEngineTransactionType> {
  method: T;
  buildTx: (
    args: ZkusdEngineTransactionArgs[T],
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
function mkZkusdTransactionConfigs(engine: InstanceType<ZkUsdEngine>): {
  [K in ZkusdEngineTransactionType]: TransactionConfig<K>;
} {
  return {
    [ZkusdEngineTransactionType.CREATE_VAULT]: {
      method: ZkusdEngineTransactionType.CREATE_VAULT,
      buildTx: async (args: CreateVaultArgs) => {
        await engine.createVault(PublicKey.fromBase58(args.vaultAddress));
      },
      requiresNewAccounts: true,
    },

    [ZkusdEngineTransactionType.DEPOSIT_COLLATERAL]: {
      method: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
      buildTx: async (args: CollateralAmountArgs) => {
        await engine.depositCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.collateralAmount)
        );
      },
    },

    [ZkusdEngineTransactionType.REDEEM_COLLATERAL]: {
      method: ZkusdEngineTransactionType.REDEEM_COLLATERAL,
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

    [ZkusdEngineTransactionType.BURN_ZKUSD]: {
      method: ZkusdEngineTransactionType.BURN_ZKUSD,
      buildTx: async (args: ZkUSDAmountArgs) => {
        await engine.burnZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.zkusdAmount)
        );
      },
    },

    [ZkusdEngineTransactionType.MINT_ZKUSD]: {
      method: ZkusdEngineTransactionType.MINT_ZKUSD,
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

    [ZkusdEngineTransactionType.LIQUIDATE]: {
      method: ZkusdEngineTransactionType.LIQUIDATE,
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
    [ZkusdEngineTransactionType.UPDATE_ADMIN]: {
      method: ZkusdEngineTransactionType.UPDATE_ADMIN,
      buildTx: async (args) => {
        const newAdmin = PublicKey.fromBase58(args.newAdmin);
        await engine.updateAdmin(newAdmin);
      },
    },
    [ZkusdEngineTransactionType.UPDATE_VALID_PRICE_BLOCK_COUNT]: {
      method: ZkusdEngineTransactionType.UPDATE_VALID_PRICE_BLOCK_COUNT,
      buildTx: async (args) => {
        await engine.updateValidPriceBlockCount(
          UInt8.from(args.newValidPriceBlockCount)
        );
      },
    },
    [ZkusdEngineTransactionType.UPDATE_ORACLE_WHITELIST]: {
      method: ZkusdEngineTransactionType.UPDATE_ORACLE_WHITELIST,
      buildTx: async (args) => {
        const whitelist: OracleWhitelist = new OracleWhitelist({
          addresses: args.oracleWhitelist.map((addr) =>
            PublicKey.fromBase58(addr)
          ),
        });
        await engine.updateOracleWhitelist(whitelist);
      },
    },
    [ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP]: {
      method: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP,
      buildTx: async (args) => {
        await engine.toggleEmergencyStop(Bool(args.shouldStop));
      },
    },
    [ZkusdEngineTransactionType.TRANSFER]: {
      method: ZkusdEngineTransactionType.TRANSFER,
      buildTx: async (args) => {
        AccountUpdate.createSigned(PublicKey.fromBase58(args.from)).send({
          to: PublicKey.fromBase58(args.to),
          amount: BigInt(args.amount),
        });
      },
    },
  };
}
