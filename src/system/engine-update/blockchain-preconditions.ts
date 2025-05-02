import { Field, Struct, UInt32, UInt64 } from 'o1js';

/**
 * Represents a validity range using UInt32 values.
 *
 * Used for checking validity of block slots.
 *
 * Properties:
 * - `firstValidSlot` — `UInt32`: Inclusive lower bound of the valid range.
 * - `lastValidSlot` — `UInt32`: Inclusive upper bound of the valid range.
 */
export class ValidityRangeUInt32 extends Struct({
  firstValidSlot: UInt32,
  lastValidSlot: UInt32,
}) {
  /**
   * Converts the ValidityRangeUInt64 into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [
      ...this.firstValidSlot.toFields(),
      ...this.lastValidSlot.toFields(),
    ];
  }

  /**
   * Creates a validity range that always passes (from 0 to UInt32.MAXINT).
   *
   * @example
   * const range = ValidityRangeUInt32.always();
   */
  static always(): ValidityRangeUInt32 {
    return new ValidityRangeUInt32({
      firstValidSlot: UInt32.from(0),
      lastValidSlot: UInt32.from(UInt32.MAXINT()),
    });
  }

  /**
   * Creates a validity range from block 0 up to a given last valid slot.
   *
   * @param lastValidSlot - The latest valid slot.
   *
   * @example
   * const range = ValidityRangeUInt32.before(50000);
   */
  static before(lastValidSlot: UInt32 | bigint | number): ValidityRangeUInt32 {
    const lastValidSlotUInt32 =
      lastValidSlot instanceof UInt32
        ? lastValidSlot
        : UInt32.from(lastValidSlot);

    return new ValidityRangeUInt32({
      firstValidSlot: UInt32.from(0),
      lastValidSlot: lastValidSlotUInt32,
    });
  }
}

/**
 * Type alias for the fields required by `MinaChainPreconditions`.
 */
export type MinaChainPreconditionsFields = {
  slotValidityRange: ValidityRangeUInt32;
};

/**
 * Represents preconditions over the Mina blockchain state.
 *
 * Combines slot validity checks.
 *
 * Properties:
 * - `slotValidityRange` — Range for the current slot validity.
 */
export class MinaChainPreconditions extends Struct({
  slotValidityRange: ValidityRangeUInt32,
}) {
  /**
   * Creates a precondition that always passes (no restrictions).
   *
   * @example
   * const preconditions = MinaChainPreconditions.always();
   */
  static always(): MinaChainPreconditions {
    return MinaChainPreconditions.create();
  }

  /**
   * Creates a `MinaChainPreconditions` instance with optional customized ranges.
   *
   * @param args - Partial object to specify slot validity range.
   *
   * @example
   * const preconditions = MinaChainPreconditions.create({
   *   slotValidityRange: ValidityRangeUInt32.before(50000n)
   * });
   */
  static create(
    args?: Partial<MinaChainPreconditionsFields>
  ): MinaChainPreconditions {
    return new MinaChainPreconditions({
      slotValidityRange:
        args?.slotValidityRange ?? ValidityRangeUInt32.always(),
    });
  }

  /**
   * Creates preconditions that validate up to specified slot.
   *
   * @param args.slot - Upper bound for slot validity
   *
   * @example
   * const preconditions = MinaChainPreconditions.before({ slot: 50000n });
   */
  static before(args: {
    slot?: UInt32 | bigint | number;
  }): MinaChainPreconditions {
    const preconditions = MinaChainPreconditions.always();

    if (args.slot !== undefined) {
      preconditions.slotValidityRange = ValidityRangeUInt32.before(args.slot);
    }
    return preconditions;
  }

  /**
   * Creates a precondition that constrains only the blockchain length.
   *
   * @param firstValidSlot - Optional lower bound
   * @param lastValidSlot - Optional upper bound
   *
   * @example
   * const preconditions = MinaChainPreconditions.slot(100, 20000);
   */
  static slotRange(
    firstValidSlot?: UInt32 | bigint | number,
    lastValidSlot?: UInt32 | bigint | number
  ): MinaChainPreconditions {
    const preconditions = MinaChainPreconditions.always();

    preconditions.slotValidityRange = new ValidityRangeUInt32({
      firstValidSlot:
        firstValidSlot !== undefined
          ? firstValidSlot instanceof UInt32
            ? firstValidSlot
            : UInt32.from(firstValidSlot)
          : UInt32.from(0),
      lastValidSlot:
        lastValidSlot !== undefined
          ? lastValidSlot instanceof UInt32
            ? lastValidSlot
            : UInt32.from(lastValidSlot)
          : UInt32.from(UInt32.MAXINT()),
    });

    return preconditions;
  }

  /**
   * Converts the MinaChainPreconditions into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [...this.slotValidityRange.toFields()];
  }
}
