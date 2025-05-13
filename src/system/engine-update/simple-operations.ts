import { Bool, Field, Provable, Struct, UInt64, UInt8 } from 'o1js';

/**
 * Define the maximum valid Field value: Field.ORDER - 1
 */
export const FieldMax = Field.from(Field.ORDER - 1n);

/**
 * @notice Operations for updating a Bool state.
 *
 * Operation codes:
 *  - 0: set to false
 *  - 1: set to true
 *  - 2: flip (negate)
 *  - 3: no-op (do nothing)
 */
export class BoolOperation extends Struct({
  operation: Field,
}) {
  /**
   * Execute the operation on the given Bool state.
   */
  execute(state: Bool): Bool {
    this.operation.assertLessThanOrEqual(3);

    const isSet = this.operation.lessThan(2);
    const setValue = Provable.if(
      this.operation.equals(1),
      Bool(true),
      Bool(false)
    );
    const isFlip = this.operation.equals(2);
    const flipped = state.not();

    return Provable.if(isSet, setValue, Provable.if(isFlip, flipped, state));
  }

  /**
   * Create a BoolOperation that sets the state.
   *
   * @param value - A Bool or native boolean.
   * @example
   * const op = BoolOperation.set(true);
   */
  static set(value: Bool | boolean): BoolOperation {
    return new BoolOperation({
      operation: Provable.if(Bool(value), Field(1), Field(0)),
    });
  }

  /**
   * Create a BoolOperation that flips the state.
   * @example
   * const op = BoolOperation.flip();
   */
  static flip(): BoolOperation {
    return new BoolOperation({
      operation: Field(2),
    });
  }

  /**
   * Create a BoolOperation that does nothing.
   * @example
   * const op = BoolOperation.noop();
   */
  static noop(): BoolOperation {
    return new BoolOperation({
      operation: Field(3),
    });
  }

  /**
   * Check if this operation is a no-op.
   */
  isNoop(): Bool {
    return this.operation.equals(3);
  }

  toFields(): Field[] {
    return [this.operation];
  }
}

/**
 * @notice Operations for updating a UInt8 state.
 *
 * Operation codes:
 *  - 0: set
 *  - 1: add
 *  - 2: subtract
 *  - 3: no-op
 */
export class UInt8Operation extends Struct({
  operation: Field,
  value: UInt8,
}) {
  /**
   * Execute the operation on the given UInt8 state.
   */
  execute(state: UInt8): UInt8 {
    this.operation.assertLessThanOrEqual(3);

    const isSet = this.operation.equals(0);
    const isAdd = this.operation.equals(1);
    const isSub = this.operation.equals(2);

    const setResult = this.value.value;
    const addResult = state.value.add(this.value.value);
    const subResult = state.value.sub(this.value.value);
    const noChange = state.value;

    const retField = Provable.if(
      isSet,
      setResult,
      Provable.if(isAdd, addResult, Provable.if(isSub, subResult, noChange))
    );

    retField.assertLessThan(256);
    return UInt8.Unsafe.fromField(retField);
  }

  /**
   * Create a UInt8Operation to set the state.
   *
   * @param value - A UInt8, number, or bigint.
   * @example
   * const op = UInt8Operation.set(42);
   */
  static set(value: UInt8 | number | bigint): UInt8Operation {
    return new UInt8Operation({
      operation: Field(0),
      value: UInt8.from(value),
    });
  }

  /**
   * Create a UInt8Operation to add to the state.
   *
   * @param value - A UInt8, number, or bigint.
   * @example
   * const op = UInt8Operation.add(5n);
   */
  static add(value: UInt8 | number | bigint): UInt8Operation {
    return new UInt8Operation({
      operation: Field(1),
      value: UInt8.from(value),
    });
  }

  /**
   * Create a UInt8Operation to subtract from the state.
   *
   * @param value - A UInt8, number, or bigint.
   * @example
   * const op = UInt8Operation.sub(3);
   */
  static sub(value: UInt8 | number | bigint): UInt8Operation {
    return new UInt8Operation({
      operation: Field(2),
      value: UInt8.from(value),
    });
  }

  /**
   * Create a UInt8Operation that does nothing.
   * @example
   * const op = UInt8Operation.noop();
   */
  static noop(): UInt8Operation {
    return new UInt8Operation({
      operation: Field(3),
      value: UInt8.from(0),
    });
  }

  /**
   * Check if this operation is a no-op.
   */
  isNoop(): Bool {
    return this.operation.equals(3);
  }

  toFields(): Field[] {
    return [this.operation, this.value.value];
  }
}

/**
 * @notice Operations for updating a Field state.
 *
 * Operation codes:
 *  - 0: set
 *  - 1: add
 *  - 2: subtract
 *  - 3: no-op
 */
export class FieldOperation extends Struct({
  operation: Field,
  value: Field,
}) {
  /**
   * Execute the operation on the given Field state.
   */
  execute(state: Field): Field {
    this.operation.assertLessThanOrEqual(3);

    const isSet = this.operation.equals(0);
    const isAdd = this.operation.equals(1);
    const isSub = this.operation.equals(2);

    const setResult = this.value;
    const addResult = state.add(this.value);
    const subResult = state.sub(this.value);
    const noChange = state;

    return Provable.if(
      isSet,
      setResult,
      Provable.if(isAdd, addResult, Provable.if(isSub, subResult, noChange))
    );
  }

  /**
   * Create a FieldOperation to set the state.
   *
   * @param value - A Field, number, or bigint.
   * @example
   * const op = FieldOperation.set(12345n);
   */
  static set(value: Field | number | bigint): FieldOperation {
    return new FieldOperation({
      operation: Field(0),
      value: Field.from(value),
    });
  }

  /**
   * Create a FieldOperation to add to the state.
   *
   * @param value - A Field, number, or bigint.
   * @example
   * const op = FieldOperation.add(1000);
   */
  static add(value: Field | number | bigint): FieldOperation {
    return new FieldOperation({
      operation: Field(1),
      value: Field.from(value),
    });
  }

  /**
   * Create a FieldOperation to subtract from the state.
   *
   * @param value - A Field, number, or bigint.
   * @example
   * const op = FieldOperation.sub(50n);
   */
  static sub(value: Field | number | bigint): FieldOperation {
    return new FieldOperation({
      operation: Field(2),
      value: Field.from(value),
    });
  }

  /**
   * Create a FieldOperation that does nothing.
   * @example
   * const op = FieldOperation.noop();
   */
  static noop(): FieldOperation {
    return new FieldOperation({
      operation: Field(3),
      value: Field(0),
    });
  }

  /**
   * Check if this operation is a no-op.
   */
  isNoop(): Bool {
    return this.operation.equals(3);
  }

  toFields(): Field[] {
    return [this.operation, this.value];
  }
}

/**
 * @notice Operations for updating a UInt64 state.
 *
 * Operation codes:
 *  - 0: set
 *  - 1: add
 *  - 2: subtract
 *  - 3: no-op
 */
export class UInt64Operation extends Struct({
  operation: Field,
  value: UInt64,
}) {
  /**
   * Execute the operation on the given UInt64 state.
   */
  execute(state: UInt64): UInt64 {
    // Ensure operation code is one of 0,1,2,3
    this.operation.assertLessThanOrEqual(3);

    const isSet = this.operation.equals(0);
    const isAdd = this.operation.equals(1);
    const isSub = this.operation.equals(2);

    const setResult = this.value.value;
    const addResult = state.value.add(this.value.value);
    const subResult = state.value.sub(this.value.value);
    const noChange = state.value;

    // Choose result based on operation
    const retField = Provable.if(
      isSet,
      setResult,
      Provable.if(isAdd, addResult, Provable.if(isSub, subResult, noChange))
    );

    // Ensure result fits within 64 bits
    retField.assertLessThan(Field.from(18446744073709551616n));

    return UInt64.Unsafe.fromField(retField);
  }

  /** Create a UInt64Operation to set the state. */
  static set(value: UInt64 | number | bigint): UInt64Operation {
    return new UInt64Operation({
      operation: Field.from(0n),
      value: UInt64.from(value),
    });
  }

  /** Create a UInt64Operation to add to the state. */
  static add(value: UInt64 | number | bigint): UInt64Operation {
    return new UInt64Operation({
      operation: Field.from(1n),
      value: UInt64.from(value),
    });
  }

  /** Create a UInt64Operation to subtract from the state. */
  static sub(value: UInt64 | number | bigint): UInt64Operation {
    return new UInt64Operation({
      operation: Field.from(2n),
      value: UInt64.from(value),
    });
  }

  /** Create a UInt64Operation that does nothing. */
  static noop(): UInt64Operation {
    return new UInt64Operation({
      operation: Field.from(3n),
      value: UInt64.from(0n),
    });
  }

  /** Check if this operation is a no-op. */
  isNoop(): Bool {
    return this.operation.equals(3);
  }

  toFields(): Field[] {
    return [this.operation, this.value.value];
  }
}

export function printOperation(
  operation: BoolOperation | UInt8Operation | FieldOperation | UInt64Operation
): string | null {
  if (operation instanceof BoolOperation) {
    if(operation.isNoop().toBoolean()) {
      return null;
    }
    const isFlip = operation.operation.equals(2).toBoolean();
    if(isFlip){
      return `BoolOperation(flip)`;
    }
    return `BoolOperation(set to ${operation.operation.equals(1).toBoolean() ? 'true' : 'false'})`;
  } else if (operation instanceof UInt8Operation) {
    if(operation.isNoop().toBoolean()) {
      return null;
    }
    const isAdd = operation.operation.equals(1).toBoolean();
    const isSub = operation.operation.equals(2).toBoolean();
    if(isAdd){
      return `UInt8Operation(add ${operation.value.toString()})`;
    }
    if(isSub){
      return `UInt8Operation(sub ${operation.value.toString()})`;
    }
    return `UInt8Operation(set to ${operation.value.toString()})`;
    
  } else if (operation instanceof FieldOperation) {
    if(operation.isNoop().toBoolean()) {
      return null;
    }
    const isAdd = operation.operation.equals(1).toBoolean();
    const isSub = operation.operation.equals(2).toBoolean();
    if(isAdd){
      return `FieldOperation(add ${operation.value.toString()})`;
    }
    if(isSub){
      return `FieldOperation(sub ${operation.value.toString()})`;
    }
    return `FieldOperation(set to ${operation.value.toString()})`;
    
  } else if (operation instanceof UInt64Operation) {
    if(operation.isNoop().toBoolean()) {
      return null;
    }
    const isAdd = operation.operation.equals(1).toBoolean();
    const isSub = operation.operation.equals(2).toBoolean();
    if(isAdd){
      return `UInt64Operation(add ${operation.value.toString()})`;
    }
    if(isSub){
      return `UInt64Operation(sub ${operation.value.toString()})`;
    }
    return `UInt64Operation(set to ${operation.value.toString()})`;
  }
  throw new Error('Unknown operation type');
}
