import { Field, Struct, UInt32 } from 'o1js';

/**
 * Represents a validity range using UInt32 values.
 *
 * Used for checking validity of block slot indices and blockchain lengths.
 *
 * Properties:
 * - `firstValidBlock` — `UInt32`: Inclusive lower bound of the valid range.
 * - `lastValidBlock` — `UInt32`: Inclusive upper bound of the valid range.
 */
export class ValidityRangeUInt32 extends Struct({
  firstValidBlock: UInt32,
  lastValidBlock: UInt32,
}) {
  /**
   * Converts the ValidityRangeUInt32 into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [
      ...this.firstValidBlock.toFields(),
      ...this.lastValidBlock.toFields(),
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
      firstValidBlock: UInt32.from(0),
      lastValidBlock: UInt32.from(UInt32.MAXINT()),
    });
  }

  /**
   * Creates a validity range from block 0 up to a given last valid block.
   *
   * @param lastValidBlock - The highest valid block index.
   *
   * @example
   * const range = ValidityRangeUInt32.before(50000);
   */
  static before(lastValidBlock: UInt32 | bigint | number): ValidityRangeUInt32 {
    const lastValidBlockUInt32 = lastValidBlock instanceof UInt32
      ? lastValidBlock
      : UInt32.from(lastValidBlock);

    return new ValidityRangeUInt32({
      firstValidBlock: UInt32.from(0),
      lastValidBlock: lastValidBlockUInt32,
    });
  }
}

/**
 * Type alias for the fields required by `MinaChainPreconditions`.
 */
export type MinaChainPreconditionsFields = {
  slotIndexValidityRange: ValidityRangeUInt32;
  blockchainLength: ValidityRangeUInt32;
};

/**
 * Represents preconditions over the Mina blockchain state.
 *
 * Combines slot index validity and blockchain length checks.
 *
 * Properties:
 * - `slotIndexValidityRange` — Range for the current slot index validity.
 * - `blockchainLength` — Range for the current blockchain length validity.
 */
export class MinaChainPreconditions extends Struct({
  slotIndexValidityRange: ValidityRangeUInt32,
  blockchainLength: ValidityRangeUInt32,
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
   * @param args - Partial object to specify slot and blockchain length validity ranges.
   *
   * @example
   * const preconditions = MinaChainPreconditions.create({
   *   slotIndexValidityRange: ValidityRangeUInt32.before(50000n)
   * });
   */
  static create(args?: Partial<MinaChainPreconditionsFields>): MinaChainPreconditions {
    return new MinaChainPreconditions({
      slotIndexValidityRange: args?.slotIndexValidityRange ?? ValidityRangeUInt32.always(),
      blockchainLength: args?.blockchainLength ?? ValidityRangeUInt32.always(),
    });
  }

  /**
   * Creates preconditions that validate up to specified slot or block numbers.
   *
   * @param args.block - Upper bound for slot index validity
   * @param args.slot - Upper bound for blockchain length validity
   *
   * @example
   * const preconditions = MinaChainPreconditions.before({ slot: 500000 });
   */
  static before(args: { block?: UInt32 | bigint | number; slot?: UInt32 | bigint | number }): MinaChainPreconditions {
    const preconditions = MinaChainPreconditions.always();

    if (args.block !== undefined) {
      preconditions.slotIndexValidityRange = ValidityRangeUInt32.before(args.block);
    }
    if (args.slot !== undefined) {
      preconditions.blockchainLength = ValidityRangeUInt32.before(args.slot);
    }
    return preconditions;
  }

  /**
   * Creates a precondition that constrains only the blockchain length.
   *
   * @param firstValidBlock - Optional lower bound
   * @param lastValidBlock - Optional upper bound
   *
   * @example
   * const preconditions = MinaChainPreconditions.blockchainLength(100, 20000);
   */
  static blockchainLength(
    firstValidBlock?: UInt32 | bigint | number,
    lastValidBlock?: UInt32 | bigint | number
  ): MinaChainPreconditions {
    const preconditions = MinaChainPreconditions.always();

    preconditions.blockchainLength = new ValidityRangeUInt32({
      firstValidBlock: firstValidBlock !== undefined
        ? (firstValidBlock instanceof UInt32 ? firstValidBlock : UInt32.from(firstValidBlock))
        : UInt32.from(0),
      lastValidBlock: lastValidBlock !== undefined
        ? (lastValidBlock instanceof UInt32 ? lastValidBlock : UInt32.from(lastValidBlock))
        : UInt32.from(UInt32.MAXINT()),
    });

    return preconditions;
  }

  /**
   * Converts the MinaChainPreconditions into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [
      ...this.slotIndexValidityRange.toFields(),
      ...this.blockchainLength.toFields(),
    ];
  }
}
