import {
  Struct,
  PublicKey,
  UInt64,
  Provable,
  Field,
  UInt32,
  Bool,
  PrivateKey,
  Poseidon,
  JsonProof,
} from 'o1js';

// ============================================================================
// Protocol Core Types
// ============================================================================

/**
 * @notice Core protocol data structure containing admin and configuration
 */
export class ProtocolData extends Struct({
  admin: PublicKey,
  validPriceBlockCount: UInt32,
  emergencyStop: Bool,
}) {
  static new(
    params: {
      admin?: PublicKey;
      validPriceBlockCount?: UInt32;
      emergencyStop?: Bool;
    } = {}
  ): ProtocolData {
    return new ProtocolData({
      admin: params.admin ?? PublicKey.empty(),
      validPriceBlockCount: params.validPriceBlockCount ?? UInt32.from(0),
      emergencyStop: params.emergencyStop ?? Bool(false),
    });
  }

  pack(): ProtocolDataPacked {
    return new ProtocolDataPacked({
      adminX: this.admin.x,
      packedData: Field.fromBits([
        ...this.validPriceBlockCount.value.toBits(32),
        this.emergencyStop,
        this.admin.isOdd,
      ]),
    });
  }

  static unpack(packed: ProtocolDataPacked) {
    const bits = packed.packedData.toBits(32 + 2);
    const validPriceBlockCount = UInt32.Unsafe.fromField(
      Field.fromBits(bits.slice(0, 32))
    );
    const emergencyStop = Bool(bits[32]);
    const adminIsOdd = Bool(bits[32 + 1]);
    const admin = PublicKey.from({
      x: packed.adminX,
      isOdd: adminIsOdd,
    });
    return new ProtocolData({
      admin: admin,
      validPriceBlockCount: validPriceBlockCount,
      emergencyStop: emergencyStop,
    });
  }
}

/**
 * @notice Packed version of protocol data for efficient storage
 */
export class ProtocolDataPacked extends Struct({
  adminX: Field,
  packedData: Field,
}) {}

// ============================================================================
// Oracle & Price Types
// ============================================================================
const MAX_ORACLE_COUNT = 8;

/**
 * @notice Whitelist of authorized oracle addresses
 */
export class OracleWhitelist extends Struct({
  addresses: Provable.Array(PublicKey, MAX_ORACLE_COUNT),
}) {
  static MAX_PARTICIPANTS = MAX_ORACLE_COUNT;
}

// DEV: not sure where to put it
//      but since there is many ways to compute the hash,
//      we must have it available for all the tools
export function computeOracleWhitelistHash(whitelist: OracleWhitelist): Field {
  return Poseidon.hash(OracleWhitelist.toFields(whitelist));
}

/**
 * @notice Represents a verified MINA price
 */
export class MinaPrice extends Struct({
  priceNanoUSD: UInt64,
  currentBlockHeight: UInt32,
}) {}

// ============================================================================
// Vault Types
// ============================================================================

/**
 * @notice Represents the state of a user's vault
 */
export class VaultState extends Struct({
  collateralAmount: UInt64,
  debtAmount: UInt64,
  owner: PublicKey,
}) {}

/**
 * @notice Results from a vault liquidation
 */
export class LiquidationResults extends Struct({
  oldVaultState: VaultState,
  liquidatorCollateral: UInt64,
  vaultOwnerCollateral: UInt64,
}) {}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * @notice Keypair type for managing public/private key pairs
 */
export interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

/**
 * @notice Helper type for contract instances
 */
export interface ContractInstance<T> {
  contract: T extends new (...args: any[]) => infer R ? R : T;
}

// ============================================================================
// Vault Transaction Types
// ============================================================================

export enum VaultTransactionType {
  CREATE_VAULT = 'createVault',
  DEPOSIT_COLLATERAL = 'depositCollateral',
  REDEEM_COLLATERAL = 'redeemCollateral',
  MINT_ZKUSD = 'mintZkUsd',
  BURN_ZKUSD = 'burnZkUsd',
  LIQUIDATE = 'liquidate',
}

export interface BaseTransactionArgs {
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
};
