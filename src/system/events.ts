import { Struct, PublicKey, UInt64, Field, Bool, UInt32 } from 'o1js';

export class VaultOwnerUpdatedEvent extends Struct({
  vaultAddress: PublicKey,
  previousOwner: PublicKey,
  newOwner: PublicKey,
}) {}

export class NewVaultEvent extends Struct({
  vaultAddress: PublicKey,
  owner: PublicKey,
}) {}

export class DepositCollateralEvent extends Struct({
  vaultAddress: PublicKey,
  amountDeposited: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class RedeemCollateralEvent extends Struct({
  vaultAddress: PublicKey,
  amountRedeemed: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
  minaPrice: UInt64,
}) {}

export class MintZkUsdEvent extends Struct({
  vaultAddress: PublicKey,
  amountMinted: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
  minaPrice: UInt64,
}) {}

export class BurnZkUsdEvent extends Struct({
  vaultAddress: PublicKey,
  amountBurned: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class LiquidateEvent extends Struct({
  vaultAddress: PublicKey,
  liquidator: PublicKey,
  vaultCollateralLiquidated: UInt64,
  vaultDebtRepaid: UInt64,
  minaPrice: UInt64,
}) {}

export class EmergencyStopToggledEvent extends Struct({
  resolutionIndex: UInt32,
  emergencyStop: Bool,
}) {}

export class ValidPriceBlockCountUpdatedEvent extends Struct({
  previousCount: UInt32,
  newCount: UInt32,
}) {}

export class AdminUpdatedEvent extends Struct({
  previousAdmin: PublicKey,
  newAdmin: PublicKey,
}) {}

export class OracleWhitelistUpdatedEvent extends Struct({
  previousHash: Field,
  newHash: Field,
}) {}
