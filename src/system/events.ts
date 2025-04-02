import { Struct, PublicKey, UInt64, Field, Bool, UInt32, UInt8, VerificationKey } from 'o1js';

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

export class CollateralRatioUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  oldRatio: UInt8,
  newRatio: UInt8,
}) {}

export class EmergencyStopToggledEvent extends Struct({
  resolutionIndex: UInt32,
  emergencyStop: Bool,
}) {}

export class ValidPriceBlockCountUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  previousCount: UInt8,
  newCount: UInt8,
}) {}

export class VerificationKeyUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  newVerificationKeyHash: Field,
}) {}

export class LiquidationBonusRatioUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  oldRatio: UInt8,
  newRatio: UInt8,
}) {}

export class ConfigMerkleRootUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  oldRoot: Field,
  newRoot: Field,
}) {}

export class AdminUpdatedEvent extends Struct({
  previousAdmin: PublicKey,
  newAdmin: PublicKey,
}) {}

export class OracleWhitelistUpdatedEvent extends Struct({
  resolutionIndex: UInt32,
  previousHash: Field,
  newHash: Field,
}) {}
