import {
  Struct,
  PublicKey,
  UInt64,
  Provable,
  Field,
  UInt32,
  Bool,
  PrivateKey,
  Signature,
  VerificationKey,
  DynamicProof,
} from 'o1js';

// ============================================================================
// Protocol Core Types
// ============================================================================

/**
 * @notice Core protocol data structure containing admin and configuration
 */
export class ProtocolData extends Struct({
  admin: PublicKey,
  oracleFlatFee: UInt64,
  emergencyStop: Bool,
}) {
  static new(
    params: {
      admin?: PublicKey;
      oracleFlatFee?: UInt64;
      emergencyStop?: Bool;
    } = {}
  ): ProtocolData {
    return new ProtocolData({
      admin: params.admin ?? PublicKey.empty(),
      oracleFlatFee: params.oracleFlatFee ?? UInt64.zero,
      emergencyStop: params.emergencyStop ?? Bool(false),
    });
  }

  pack(): ProtocolDataPacked {
    return new ProtocolDataPacked({
      adminX: this.admin.x,
      packedData: Field.fromBits([
        ...this.oracleFlatFee.value.toBits(64),
        this.emergencyStop,
        this.admin.isOdd,
      ]),
    });
  }

  static unpack(packed: ProtocolDataPacked) {
    const bits = packed.packedData.toBits(64 + 2);
    const oracleFlatFee = UInt64.Unsafe.fromField(
      Field.fromBits(bits.slice(0, 64))
    );
    const emergencyStop = Bool(bits[64]);
    const adminIsOdd = Bool(bits[64 + 1]);
    const admin = PublicKey.from({
      x: packed.adminX,
      isOdd: adminIsOdd,
    });
    return new ProtocolData({
      admin: admin,
      oracleFlatFee: oracleFlatFee,
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

/**
 * @notice Represents a single price submission from an oracle
 */
export class PriceSubmission extends Struct({
  publicKey: PublicKey,
  signature: Signature,
  price: UInt64,
  blockHeight: UInt32,
}) {}

/**
 * @notice Collection of oracle price submissions
 */
export class OraclePriceSubmissions extends Struct({
  submissions: Provable.Array(PriceSubmission, 8),
}) {}

/**
 * @notice Whitelist of authorized oracle addresses
 */
export class OracleWhitelist extends Struct({
  addresses: Provable.Array(PublicKey, 8),
}) {
  static MAX_PARTICIPANTS = 8;
}

/**
 * @notice Represents a verified MINA price
 */
export class MinaPrice extends Struct({
  priceNanoUSD: UInt64,
  currentBlockHeight: UInt32,
}) {}

/**
 * @notice Input data structure for price aggregation proof
 */
export class PriceAggregationProofPublicInput extends Struct({
  oracleWhitelist: OracleWhitelist,
  oraclePriceSubmissions: OraclePriceSubmissions,
  fallbackPriceSubmission: PriceSubmission,
  currentBlockHeight: UInt32,
}) {}

/**
 * @notice Output data structure from price aggregation proof
 */
export class PriceAggregationProofPublicOutput extends Struct({
  minaPrice: MinaPrice,
  incentivizedOracle: PublicKey,
  protocolAdmin: PublicKey,
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
// Oracle Proof Types
// ============================================================================

/**
 * @notice Input structure for Mina price verification
 */
export class PriceAggregationProof extends DynamicProof<
  PriceAggregationProofPublicInput,
  PriceAggregationProofPublicOutput
> {
  static publicInputType = PriceAggregationProofPublicInput;
  static publicOutputType = PriceAggregationProofPublicOutput;
}
export class MinaPriceInput extends Struct({
  proof: PriceAggregationProof,
  verificationKey: VerificationKey,
}) {}
