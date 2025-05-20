// ===========================================================================
// Protocol Core Types
// ===========================================================================

import { Struct, Bool, Field, UInt8, UInt64, UInt32 } from 'o1js';

/**
 * @notice Core protocol data structure containing admin and configuration
 */
export class SettlementData extends Struct({
  sequence: UInt32,
  blockNumber: UInt32,
  validPriceBlockCount: UInt8,
  emergencyStop: Bool,
  vaultDebtCeiling: UInt64,
  collateralRatio: UInt8,
  liquidationBonusRatio: UInt8,
}) {
  static new(
    params: {
      sequence?: UInt32;
      blockNumber?: UInt32;
      validPriceBlockCount?: UInt8;
      emergencyStop?: Bool;
      vaultDebtCeiling?: UInt64;
      collateralRatio?: UInt8;
      liquidationBonusRatio?: UInt8;
    } = {}
  ): SettlementData {
    return new SettlementData({
      sequence: params.sequence ?? UInt32.from(0),
      blockNumber: params.blockNumber ?? UInt32.from(0),
      validPriceBlockCount: params.validPriceBlockCount ?? UInt8.from(0),
      emergencyStop: params.emergencyStop ?? Bool(false),
      vaultDebtCeiling: params.vaultDebtCeiling ?? UInt64.from(0n),
      collateralRatio: params.collateralRatio ?? UInt8.from(0),
      liquidationBonusRatio: params.liquidationBonusRatio ?? UInt8.from(0),
    });
  }

  pack(): SettlementDataPacked {
    // pack all subfields into a single bitfield, ending with a 64‑bit ceiling
    const bits = [
      ...this.sequence.value.toBits(32),
      ...this.blockNumber.value.toBits(32),
      ...this.validPriceBlockCount.value.toBits(8),
      this.emergencyStop,
      ...this.collateralRatio.value.toBits(8),
      ...this.liquidationBonusRatio.value.toBits(8),
      ...this.vaultDebtCeiling.value.toBits(64),
    ];
    return new SettlementDataPacked({
      packedData: Field.fromBits(bits),
    });
  }

  static unpack(packed: SettlementDataPacked): SettlementData {
    // define the bit‐lengths in the same order we packed them
    const bitFields = [
      { name: 'sequence', length: 32 },
      { name: 'blockNumber', length: 32 },
      { name: 'validPriceBlockCount', length: 8 },
      { name: 'emergencyStop', length: 1 },
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

    const sequence = UInt32.Unsafe.fromField(readBits(32));
    const blockNumber = UInt32.Unsafe.fromField(readBits(32));
    const validPriceBlockCount = UInt8.Unsafe.fromField(readBits(8));
    const emergencyStop = readBits(1).equals(1);
    const collateralRatio = UInt8.Unsafe.fromField(readBits(8));
    const liquidationBonusRatio = UInt8.Unsafe.fromField(readBits(8));
    const vaultDebtCeiling = UInt64.Unsafe.fromField(readBits(64));

    return new SettlementData({
      sequence,
      blockNumber,
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
export class SettlementDataPacked extends Struct({
  packedData: Field,
}) {}
