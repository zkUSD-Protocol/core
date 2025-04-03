import { Bool, Field, Provable, Struct, UInt8 } from 'o1js'; // or your zk library

// Define the max valid Field value: Field.ORDER - 1
export const FieldMax = Field.from(Field.ORDER - 1n);

export class BoolOperation extends Struct({
  operation: Field,
}) {
  execute(state: Bool): Bool {
    this.operation.assertLessThanOrEqual(3);
    const isSet: Bool = this.operation.lessThan(2);
    const setValue: Bool = Provable.if(
      this.operation.equals(1),
      Bool(true),
      Bool(false)
    );
    const isFlip: Bool = this.operation.equals(2);
    const flipped: Bool = state.not();
    // const isNoop: Bool = this.operation.equals(3);

    return Provable.if(isSet, setValue, Provable.if(isFlip, flipped, state));
  }

  static mkSetTo(value: Bool) {
    return new BoolOperation({
      operation: Provable.if(value, Field.from(1), Field.from(0)),
    });
  }

  static mkFlip() {
    return new BoolOperation({
      operation: Field.from(2),
    });
  }

  static mkNoop() {
    return new BoolOperation({
      operation: Field.from(3),
    });
  }
}

/**
 * @notice Operations for updating a UInt8 state, with the following codes:
 *  0 => set
 *  1 => add
 *  2 => subtract
 *  3 => no-op
 */
export class UInt8Operation extends Struct({
  operation: Field,
  value: UInt8,
}) {
  execute(state: UInt8): UInt8 {
    // Strict check: fail if operation > 3
    this.operation.assertLessThanOrEqual(3);

    // Evaluate which operation to apply
    const isSet = this.operation.equals(0);
    const isAdd = this.operation.equals(1);
    const isSub = this.operation.equals(2);
    // 3 => no-op

    // Potential results
    const setResult = this.value.value;
    const addResult = state.value.add(this.value.value);
    const subResult = state.value.sub(this.value.value);
    const noChange = state.value;

    // Nest the conditions:
    //  1) If isSet => setResult
    //  2) Else if isAdd => addResult
    //  3) Else if isSub => subResult
    //  4) Else => noChange
    const retField: Field = Provable.if(
      isSet,
      setResult,
      Provable.if(isAdd, addResult, Provable.if(isSub, subResult, noChange))
    );

    // Enforce the final result is < 256 (valid UInt8 range)
    retField.assertLessThan(256);

    // Return the new state as a UInt8
    return UInt8.Unsafe.fromField(retField);
  }

  /**
   * @dev Set the state to the given value
   */
  static mkSetTo(value: UInt8): UInt8Operation {
    return new UInt8Operation({
      operation: Field(0),
      value,
    });
  }

  /**
   * @dev Add the given value to the current state
   */
  static mkAdd(value: UInt8): UInt8Operation {
    return new UInt8Operation({
      operation: Field(1),
      value,
    });
  }

  /**
   * @dev Subtract the given value from the current state
   */
  static mkSub(value: UInt8): UInt8Operation {
    return new UInt8Operation({
      operation: Field(2),
      value,
    });
  }

  /**
   * @dev No-op: leave the state unchanged
   */
  static mkNoop(): UInt8Operation {
    return new UInt8Operation({
      operation: Field(3),
      // The 'value' field is unused when operation=3, so it can be anything
      value: UInt8.from(0),
    });
  }
}

/**
 * @notice Operations for updating a Field state, with the following codes:
 *  0 => set
 *  1 => add
 *  2 => subtract
 *  3 => no-op
 */
export class FieldOperation extends Struct({
  operation: Field,
  value: Field,
}) {
  execute(state: Field): Field {
    // Strict check: fail if operation > 3
    this.operation.assertLessThanOrEqual(3);

    // Evaluate which operation to apply
    const isSet = this.operation.equals(0);
    const isAdd = this.operation.equals(1);
    const isSub = this.operation.equals(2);
    // 3 => no-op

    // Potential results
    const setResult = this.value;
    const addResult = state.add(this.value);
    const subResult = state.sub(this.value);
    const noChange = state;

    // Nest the conditions:
    //  1) If isSet => setResult
    //  2) Else if isAdd => addResult
    //  3) Else if isSub => subResult
    //  4) Else => noChange
    const retField: Field = Provable.if(
      isSet,
      setResult,
      Provable.if(isAdd, addResult, Provable.if(isSub, subResult, noChange))
    );

    // Return the new state as a Field
    return retField;
  }

  /**
   * @dev Set the state to the given value
   */
  static mkSetTo(value: Field): FieldOperation {
    return new FieldOperation({
      operation: Field(0),
      value,
    });
  }

  /**
   * @dev Add the given value to the current state
   */
  static mkAdd(value: Field): FieldOperation {
    return new FieldOperation({
      operation: Field(1),
      value,
    });
  }

  /**
   * @dev Subtract the given value from the current state
   */
  static mkSub(value: Field): FieldOperation {
    return new FieldOperation({
      operation: Field(2),
      value,
    });
  }

  /**
   * @dev No-op: leave the state unchanged
   */
  static mkNoop(): FieldOperation {
    return new FieldOperation({
      operation: Field(3),
      // The 'value' field is unused when operation=3, so it can be anything
      value: Field.from(0),
    });
  }
}
