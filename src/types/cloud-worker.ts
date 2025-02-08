// ============================================================================
// Cloud Worker / UI Types
// ============================================================================

import { JsonProof } from 'o1js';

export enum VaultTransactionType {
  CREATE_VAULT = 'createVault',
  DEPOSIT_COLLATERAL = 'depositCollateral',
  REDEEM_COLLATERAL = 'redeemCollateral',
  MINT_ZKUSD = 'mintZkUsd',
  BURN_ZKUSD = 'burnZkUsd',
  LIQUIDATE = 'liquidate',
}

export interface BaseTransactionArgs {
  transactionId: string;
  vaultAddress: string;
}

export interface CreateVaultArgs extends BaseTransactionArgs {
  newAccounts: number;
}

export interface CollateralAmountArgs extends BaseTransactionArgs {
  collateralAmount: string; // Amount in MINA
}

export interface ZkUSDAmountArgs extends BaseTransactionArgs {
  zkusdAmount: string; // Amount in zkUSD
}

export interface PriceProofArgs extends BaseTransactionArgs {
  minaPriceProof: JsonProof;
}

export interface CollateralAmountAndPriceProofArgs
  extends CollateralAmountArgs,
    PriceProofArgs {}
export interface ZkUSDAmountAndPriceProofArgs
  extends ZkUSDAmountArgs,
    PriceProofArgs {}

export type VaultTransactionArgs = {
  [VaultTransactionType.CREATE_VAULT]: CreateVaultArgs;
  [VaultTransactionType.DEPOSIT_COLLATERAL]: CollateralAmountArgs;
  [VaultTransactionType.REDEEM_COLLATERAL]: CollateralAmountAndPriceProofArgs;
  [VaultTransactionType.MINT_ZKUSD]: ZkUSDAmountAndPriceProofArgs;
  [VaultTransactionType.BURN_ZKUSD]: ZkUSDAmountArgs;
  [VaultTransactionType.LIQUIDATE]: PriceProofArgs;
  // TODO support also other engine methods?
};
