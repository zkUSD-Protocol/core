// ============================================================================
// Protocol Core Types
// ============================================================================

import { Struct, PublicKey, UInt32, Bool, Field } from 'o1js';

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
