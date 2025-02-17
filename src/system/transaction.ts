import { JsonProof } from 'o1js';
import { SizedArray } from '../types/utility';
import { OracleWhitelist } from './oracle';

export enum ZkusdEngineTransactionType {
  // vault
  CREATE_VAULT = 'createVault',
  DEPOSIT_COLLATERAL = 'depositCollateral',
  REDEEM_COLLATERAL = 'redeemCollateral',
  MINT_ZKUSD = 'mintZkUsd',
  BURN_ZKUSD = 'burnZkUsd',
  LIQUIDATE = 'liquidate',
  // admin
  UPDATE_ADMIN = 'updateAdmin',
  UPDATE_VALID_PRICE_BLOCK_COUNT = 'updateValidPriceBlockCount',
  UPDATE_ORACLE_WHITELIST = 'updateOracleWhitelist',
  TOGGLE_EMERGENCY_STOP = 'toggleEmergencyStop',
}

export interface BaseZkusdEngineTransactionArgs {
  transactionId: string;
}

export interface BaseVaultTransactionArgs extends BaseZkusdEngineTransactionArgs {
  vaultAddress: string;
}

export interface CreateVaultArgs extends BaseVaultTransactionArgs {
  newAccounts: number;
}

export interface CollateralAmountArgs extends BaseVaultTransactionArgs {
  collateralAmount: string; // Amount in MINA
}

export interface ZkUSDAmountArgs extends BaseVaultTransactionArgs {
  zkusdAmount: string; // Amount in zkUSD
}

export interface PriceProofArgs extends BaseVaultTransactionArgs {
  minaPriceProof: JsonProof;
}

export interface EmergencyStopArgs extends BaseVaultTransactionArgs {
  shouldStop: boolean;
}

export interface UpdateAdminArgs extends BaseZkusdEngineTransactionArgs {
  newAdmin: string;
}

export interface ToggleEmergencyStopArgs extends BaseZkusdEngineTransactionArgs {
  shouldStop: boolean;
}

export interface OracleWhitelistArgs extends BaseZkusdEngineTransactionArgs {
  oracleWhitelist: SizedArray<string, typeof OracleWhitelist.MAX_PARTICIPANTS>;
}

export interface UpdateValidPriceBlockCountArgs extends BaseZkusdEngineTransactionArgs {
  newValidPriceBlockCount: number;
}

export interface CollateralAmountAndPriceProofArgs
  extends CollateralAmountArgs,
    PriceProofArgs {}
export interface ZkUSDAmountAndPriceProofArgs
  extends ZkUSDAmountArgs,
    PriceProofArgs {}

export type ZkusdEngineTransactionArgs = {
  // vault
  [ZkusdEngineTransactionType.CREATE_VAULT]: CreateVaultArgs;
  [ZkusdEngineTransactionType.DEPOSIT_COLLATERAL]: CollateralAmountArgs;
  [ZkusdEngineTransactionType.REDEEM_COLLATERAL]: CollateralAmountAndPriceProofArgs;
  [ZkusdEngineTransactionType.MINT_ZKUSD]: ZkUSDAmountAndPriceProofArgs;
  [ZkusdEngineTransactionType.BURN_ZKUSD]: ZkUSDAmountArgs;
  [ZkusdEngineTransactionType.LIQUIDATE]: PriceProofArgs;
  // admin
  [ZkusdEngineTransactionType.UPDATE_ADMIN]: UpdateAdminArgs;
  [ZkusdEngineTransactionType.UPDATE_VALID_PRICE_BLOCK_COUNT]: UpdateValidPriceBlockCountArgs;
  [ZkusdEngineTransactionType.UPDATE_ORACLE_WHITELIST]: OracleWhitelistArgs;
  [ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP]: ToggleEmergencyStopArgs;
};

export type TransactionArgs =
  | {
      transactionType: ZkusdEngineTransactionType.BURN_ZKUSD;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.BURN_ZKUSD];
    }
  | {
      transactionType: ZkusdEngineTransactionType.CREATE_VAULT;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.CREATE_VAULT];
    }
  | {
      transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.DEPOSIT_COLLATERAL];
    }
  | {
      transactionType: ZkusdEngineTransactionType.LIQUIDATE;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.LIQUIDATE];
    }
  | {
      transactionType: ZkusdEngineTransactionType.MINT_ZKUSD;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.MINT_ZKUSD];
    }
  | {
      transactionType: ZkusdEngineTransactionType.REDEEM_COLLATERAL;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.REDEEM_COLLATERAL];
    }
  | {
      transactionType: ZkusdEngineTransactionType.UPDATE_ADMIN;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.UPDATE_ADMIN];
    }
  | {
      transactionType: ZkusdEngineTransactionType.UPDATE_VALID_PRICE_BLOCK_COUNT;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.UPDATE_VALID_PRICE_BLOCK_COUNT];
    }
  | {
      transactionType: ZkusdEngineTransactionType.UPDATE_ORACLE_WHITELIST;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.UPDATE_ORACLE_WHITELIST];
    }
  | {
      transactionType: ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP;
      args: ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.TOGGLE_EMERGENCY_STOP];
    };

