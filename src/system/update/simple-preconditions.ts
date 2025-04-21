import { Bool, Field, Provable, Struct, UInt8 } from 'o1js';

/**
 * @notice Maximal valid Field value (Field.ORDER - 1).
 */
const FieldMax = Field.from(Field.ORDER - 1n);

/**
 * @notice Maximal valid UInt8 value (255).
 */
const UInt8Max = UInt8.from(255);

/**
 * @notice Precondition over a `Field` value by simple equality or inequality.
 */
export class HashPrecondition extends Struct({
  state: Field,
  not: Field,
}) {
  matches(value: Field): Bool {
    const equalityCheck = value.equals(this.state);
    const nonEqualityCheck = equalityCheck.not();
    const unconstrainedCheck = Bool(true);

    return Provable.if(
      this.not.equals(Field.from(0)),
      equalityCheck,
      Provable.if(
        this.not.equals(Field.from(1)),
        nonEqualityCheck,
        unconstrainedCheck
      )
    );
  }

  /**
   * Require exact equality to a value.
   *
   * @param value - Field | number | bigint
   */
  static equal(value: Field | number | bigint): HashPrecondition {
    return new HashPrecondition({
      state: Field.from(value),
      not: Field.from(0),
    });
  }

  /**
   * Require value to be different.
   *
   * @param value - Field | number | bigint
   */
  static differentThan(value: Field | number | bigint): HashPrecondition {
    return new HashPrecondition({
      state: Field.from(value),
      not: Field.from(1),
    });
  }

  /**
   * Allow any value (no constraint).
   */
  static unconstrained(): HashPrecondition {
    return new HashPrecondition({
      state: Field.from(0),
      not: Field.from(2),
    });
  }

  toFields(): Field[] {
    return [this.state, this.not];
  }
}

/**
 * @notice Precondition over a `Field` value with range check or negated range.
 */
export class FieldPrecondition extends Struct({
  lower: Field,
  upper: Field,
  not: Bool,
}) {
  matches(value: Field): Bool {
    const greaterOrEqualLower = value.greaterThanOrEqual(this.lower);
    const lessOrEqualUpper = value.lessThanOrEqual(this.upper);
    const rangeCheck = greaterOrEqualLower.and(lessOrEqualUpper);

    return Provable.if(this.not, rangeCheck.not(), rangeCheck);
  }

  static equal(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(value),
      upper: Field.from(value),
      not: Bool(false),
    });
  }

  static differentThan(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(value),
      upper: Field.from(value),
      not: Bool(true),
    });
  }

  static greaterThan(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(value).add(1),
      upper: FieldMax,
      not: Bool(false),
    });
  }

  static greaterOrEqual(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(value),
      upper: FieldMax,
      not: Bool(false),
    });
  }

  static lessThan(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: Field.from(value).sub(1),
      not: Bool(false),
    });
  }

  static lessOrEqual(value: Field | number | bigint): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: Field.from(value),
      not: Bool(false),
    });
  }

  static unconstrained(): FieldPrecondition {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: FieldMax,
      not: Bool(false),
    });
  }

  toFields(): Field[] {
    return [this.lower, this.upper, this.not.toField()];
  }
}

/**
 * @notice Precondition over a `Bool` value (true, false, or unconstrained).
 */
export class BoolPrecondition extends Struct({
  value: Field,
}) {
  requireFalse(): Bool {
    return this.value.equals(Field.from(0));
  }

  requireTrue(): Bool {
    return this.value.equals(Field.from(1));
  }

  unconstrained(): Bool {
    return this.value.equals(Field.from(2));
  }

  matches(value: Bool): Bool {
    return this.unconstrained()
      .or(this.requireTrue().and(value))
      .or(this.requireFalse().and(value.not()));
  }

  /**
   * Require the boolean value to be exactly true or false.
   *
   * @param value - Bool | boolean
   */
  static equal(value: Bool | boolean): BoolPrecondition {
    return new BoolPrecondition({
      value: Field.from(Bool(value).toBoolean() ? 1 : 0),
    });
  }

  /**
   * Allow any boolean value.
   */
  static unconstrained(): BoolPrecondition {
    return new BoolPrecondition({
      value: Field.from(2),
    });
  }

  toFields(): Field[] {
    return [this.value];
  }
}

/**
 * @notice Precondition over a `UInt8` value with range check or negated range.
 */
export class UInt8Precondition extends Struct({
  lower: UInt8,
  upper: UInt8,
  not: Bool,
}) {
  matches(value: UInt8): Bool {
    const greaterOrEqualLower = value.greaterThanOrEqual(this.lower);
    const lessOrEqualUpper = value.lessThanOrEqual(this.upper);
    const rangeCheck = greaterOrEqualLower.and(lessOrEqualUpper);

    return Provable.if(this.not, rangeCheck.not(), rangeCheck);
  }

  static equal(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(value),
      upper: UInt8.from(value),
      not: Bool(false),
    });
  }

  static differentThan(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(value),
      upper: UInt8.from(value),
      not: Bool(true),
    });
  }

  static greaterThan(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(value).add(1),
      upper: UInt8Max,
      not: Bool(false),
    });
  }

  static greaterOrEqual(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(value),
      upper: UInt8Max,
      not: Bool(false),
    });
  }

  static lessThan(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(0),
      upper: UInt8.from(value).sub(1),
      not: Bool(false),
    });
  }

  static lessOrEqual(value: UInt8 | number | bigint): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(0),
      upper: UInt8.from(value),
      not: Bool(false),
    });
  }

  static unconstrained(): UInt8Precondition {
    return new UInt8Precondition({
      lower: UInt8.from(0),
      upper: UInt8Max,
      not: Bool(false),
    });
  }

  toFields(): Field[] {
    return [this.lower.value, this.upper.value, this.not.toField()];
  }
}
