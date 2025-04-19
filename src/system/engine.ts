// ===========================================================================
// Protocol Core Types
// ===========================================================================

import { Struct, PublicKey, Bool, Field, UInt8, UInt64 } from 'o1js';
import { VaultParams } from './vault';

export const ZkUsdEngineMethodCodes = {
  GovStopProtocol: Field.from(1100001n),
  GovUpdateCollateralRatio: Field.from(1100002n),
  GovUpdateValidPriceBlockCount: Field.from(1100003n),
  GovUpdateLiquidationBonusRatio: Field.from(1100004n),
  GovUpdateOracleWhitelist: Field.from(1100005n),
  GovUpdateVaultDebtCeiling: Field.from(1100006n),
  GovCRITICALUpdateVerificationKey: Field.from(1200005n),
};

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
  validPriceBlockCount: UInt8,
  emergencyStop: Bool,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
  vaultDebtCeiling: UInt64,
}) {
  static new(
    params: {
      admin?: PublicKey;
      validPriceBlockCount?: UInt8;
      emergencyStop?: Bool;
      collateralRatio?: UInt8;
      liquidationBonusRatio?: UInt8;
      vaultDebtCeiling?: UInt64;
    } = {}
  ): ProtocolData {
    return new ProtocolData({
      admin: params.admin ?? PublicKey.empty(),
      validPriceBlockCount: params.validPriceBlockCount ?? UInt8.from(0),
      emergencyStop: params.emergencyStop ?? Bool(false),
      collateralRatio: params.collateralRatio ?? UInt8.from(0),
      liquidationBonusRatio:
        params.liquidationBonusRatio ?? UInt8.from(0),
      vaultDebtCeiling:
        params.vaultDebtCeiling ?? UInt64.from(0n),
    });
  }

  pack(): ProtocolDataPacked {
    // pack all subfields into a single bitfield, ending with a 64‑bit ceiling
    const bits = [
      ...this.validPriceBlockCount.value.toBits(8),
      this.emergencyStop,
      this.admin.isOdd,
      ...this.collateralRatio.value.toBits(8),
      ...this.liquidationBonusRatio.value.toBits(8),
      ...this.vaultDebtCeiling.value.toBits(64),
    ];
    return new ProtocolDataPacked({
      adminX: this.admin.x,
      packedData: Field.fromBits(bits),
    });
  }

  getVaultParams(): VaultParams {
    return {
      collateralRatio: this.collateralRatio,
      liquidationBonusRatio: this.liquidationBonusRatio,
    };
  }

  static unpack(packed: ProtocolDataPacked): ProtocolData {
    // define the bit‐lengths in the same order we packed them
    const bitFields = [
      { name: 'validPriceBlockCount', length: 8 },
      { name: 'emergencyStop', length: 1 },
      { name: 'adminIsOdd', length: 1 },
      { name: 'collateralRatio', length: 8 },
      { name: 'liquidationBonusRatio', length: 8 },
      { name: 'vaultDebtCeiling', length: 64 },
    ];

    const TOTAL_BITS = bitFields.reduce((sum, f) => sum + f.length, 0);
    if (TOTAL_BITS > 254) {
      throw new Error(
        `ProtocolDataPacked uses ${TOTAL_BITS} bits, exceeding the 254-bit limit.`
      );
    }

    const bits = packed.packedData.toBits(TOTAL_BITS);
    let offset = 0;
    const readBits = (len: number) => {
      const slice = bits.slice(offset, offset + len);
      offset += len;
      return Field.fromBits(slice);
    };

    const validPriceBlockCount = UInt8.Unsafe.fromField(readBits(8));
    const emergencyStop = readBits(1).equals(1);
    const adminIsOdd = readBits(1).equals(1);
    const collateralRatio = UInt8.Unsafe.fromField(readBits(8));
    const liquidationBonusRatio =
      UInt8.Unsafe.fromField(readBits(8));
    const vaultDebtCeiling =
      UInt64.Unsafe.fromField(readBits(64));
    const admin = PublicKey.from({
      x: packed.adminX,
      isOdd: adminIsOdd,
    });

    return new ProtocolData({
      admin,
      validPriceBlockCount,
      emergencyStop,
      collateralRatio,
      liquidationBonusRatio,
      vaultDebtCeiling,
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
