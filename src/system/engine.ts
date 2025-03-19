// ============================================================================
// Protocol Core Types
// ============================================================================

import { Struct, PublicKey, UInt32, Bool, Field, UInt8 } from 'o1js';
import { VaultParams } from './vault';

export const ZkUsdEngineMethodCodes = {
  GovStopProtocol: Field.from(1100110n),
}

// Errors
export const ZkUsdEngineErrors = {
  UPDATES_BLOCKED:
    'Updates to the engine accounts can only be made by the engine',
  VAULT_EXISTS: 'Vault already exists',
  SENDER_NOT_WHITELISTED: 'Sender not in the whitelist',
  INVALID_WHITELIST: 'Invalid whitelist',
  PENDING_ACTION_EXISTS: 'Address already has a pending action',
  EMERGENCY_HALT:
    'Oracle is in emergency mode - all protocol actions are suspended',
  AMOUNT_ZERO: 'Amount must be greater than zero',
  INVALID_FEE:
    'Protocol fee is a percentage and must be less than or equal to 100',
  INSUFFICIENT_BALANCE: 'Insufficient balance for withdrawal',
};

/**
 * @notice Core protocol data structure containing admin and configuration
 */
export class ProtocolData extends Struct({
  admin: PublicKey,
  validPriceBlockCount: UInt32,
  emergencyStop: Bool,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {
  static new(
    params: {
      admin?: PublicKey;
      validPriceBlockCount?: UInt32;
      emergencyStop?: Bool;
      collateralRatio?: UInt8;
      liquidationBonusRatio?: UInt8;
    } = {}
  ): ProtocolData {
    return new ProtocolData({
      admin: params.admin ?? PublicKey.empty(),
      validPriceBlockCount: params.validPriceBlockCount ?? UInt32.from(0),
      emergencyStop: params.emergencyStop ?? Bool(false),
      collateralRatio: params.collateralRatio ?? UInt8.from(0),
      liquidationBonusRatio: params.liquidationBonusRatio ?? UInt8.from(0),
    });
  }

  pack(): ProtocolDataPacked {
    return new ProtocolDataPacked({
      adminX: this.admin.x,
      packedData: Field.fromBits([
        ...this.validPriceBlockCount.value.toBits(32),
        this.emergencyStop,
        this.admin.isOdd,
        ...this.collateralRatio.value.toBits(8),
        ...this.liquidationBonusRatio.value.toBits(8),
      ]),
    });
  }

  getVaultParams(): VaultParams {
    return {
      collateralRatio: this.collateralRatio,
      liquidationBonusRatio: this.liquidationBonusRatio,
    };
  }

  static unpack(packed: ProtocolDataPacked) {
    // Bit field definitions
    const bitFields = [
      { name: 'validPriceBlockCount', length: 32 },
      { name: 'emergencyStop', length: 1 },
      { name: 'adminIsOdd', length: 1 },
      { name: 'collateralRatio', length: 8 },
      { name: 'liquidationBonusRatio', length: 8 },
    ];

    // Calculate total bits and assert the limit
    const TOTAL_BITS = bitFields.reduce((sum, { length }) => sum + length, 0);
    if (TOTAL_BITS > 254) {
      throw new Error(
        `ProtocolDataPacked uses ${TOTAL_BITS} bits, exceeding the 254-bit limit.`
      );
    }

    const bits = packed.packedData.toBits(TOTAL_BITS);

    // Extract fields from bits using offsets
    let offset = 0;
    const readBits = (length: number) => {
      const slice = bits.slice(offset, offset + length);
      offset += length;
      return Field.fromBits(slice);
    };

    const validPriceBlockCount = UInt32.Unsafe.fromField(readBits(32));
    const emergencyStop = readBits(1).equals(1);
    const adminIsOdd = readBits(1).equals(1);
    const admin = PublicKey.from({ x: packed.adminX, isOdd: adminIsOdd });
    const collateralRatio = UInt8.Unsafe.fromField(readBits(8));
    const liquidationBonusRatio = UInt8.Unsafe.fromField(readBits(8));

    return new ProtocolData({
      admin,
      validPriceBlockCount,
      emergencyStop,
      collateralRatio,
      liquidationBonusRatio,
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
