import { JsonProof } from 'o1js';
import { SizedArray } from '../types/utility';
import { OracleWhitelist } from './oracle';
import { ZkusdGovUpdateWitness } from './governance';
import { ZkusdProtocolUpdateSpec } from './governance-update/input';

export enum ZkusdEngineTransactionType {
  // vault
  CREATE_VAULT = 'createVault',
  DEPOSIT_COLLATERAL = 'depositCollateral',
  REDEEM_COLLATERAL = 'redeemCollateral',
  MINT_ZKUSD = 'mintZkUsd',
  BURN_ZKUSD = 'burnZkUsd',
  LIQUIDATE = 'liquidate',
  // admin // TODO replace with gov methods
  UPDATE_ADMIN = 'updateAdmin',
  UPDATE_VALID_PRICE_BLOCK_COUNT = 'updateValidPriceBlockCount',
  UPDATE_ORACLE_WHITELIST = 'updateOracleWhitelist',
  TOGGLE_EMERGENCY_STOP = 'toggleEmergencyStop',
  // auxilliary
  TRANSFER = 'transfer',
}

export interface BaseZkusdEngineTransactionArgs {
  transactionId: string;
}

export interface BaseVaultTransactionArgs
  extends BaseZkusdEngineTransactionArgs {
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

export interface GovUpdateArgs extends BaseZkusdEngineTransactionArgs {
  updateSpec: ZkusdProtocolUpdateSpec;
  resolutionWitness: ZkusdGovUpdateWitness;
}

export interface ToggleEmergencyStopArgs extends GovUpdateArgs {}

export interface OracleWhitelistArgs extends GovUpdateArgs {
  oracleWhitelist: SizedArray<string, typeof OracleWhitelist.MAX_PARTICIPANTS>;
}

export interface UpdateValidPriceBlockCountArgs extends GovUpdateArgs {}

export interface SenderTransferArgs extends BaseZkusdEngineTransactionArgs {
  from: string;
  to: string;
  amount: string;
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
  // auxilliary
  [ZkusdEngineTransactionType.TRANSFER]: SenderTransferArgs;
};

/** Type-safe transaction arguments. */
export type TransactionArgs = {
  [K in keyof ZkusdEngineTransactionArgs]: {
    transactionType: K;
    args: ZkusdEngineTransactionArgs[K];
  };
}[keyof ZkusdEngineTransactionArgs];
