import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Bool, Field, Provable, UInt8 } from 'o1js';
import {
  BoolOperation,
  FieldMax,
  FieldOperation,
  UInt8Operation,
} from '../../../../system/engine-update/simple-operations.js';

describe('Operation Classes Test Suite', () => {
  //
  // Common variables, re-instantiated before each test.
  //
  let initialBool: Bool;
  let initialUInt8: UInt8;
  let initialField: Field;

  beforeEach(() => {
    initialBool = Bool(false); // reset for each test
    initialUInt8 = UInt8.from(50);
    initialField = Field(100);
  });

  //
  // Tests for BoolOperation
  //
  describe('BoolOperation', () => {
    it('should set state to true using set(true)', () => {
      const op = BoolOperation.set(Bool(true));
      const newState = op.execute(initialBool);
      assert.strictEqual(newState.toBoolean(), true);
    });

    it('should set state to false using set(false)', () => {
      const op = BoolOperation.set(Bool(false));
      const newState = op.execute(Bool(true));
      assert.strictEqual(newState.toBoolean(), false);
    });

    it('should flip the state using flip', () => {
      const op = BoolOperation.flip();
      // flipping from false => true
      const newState = op.execute(initialBool);
      assert.strictEqual(newState.toBoolean(), true);

      // flipping again => false
      const newState2 = op.execute(newState);
      assert.strictEqual(newState2.toBoolean(), false);
    });

    it('should no-op the state if operation=3 (noop)', () => {
      const op = BoolOperation.noop();
      const newState = op.execute(Bool(true));
      assert.strictEqual(
        newState.toBoolean(),
        true,
        'No-op should not change state'
      );
      const newState2 = op.execute(initialBool);
      assert.strictEqual(
        newState2.toBoolean(),
        false,
        'No-op should not change state'
      );
    });

    it('should throw on invalid operation (> 3)', () => {
      const op = new BoolOperation({ operation: Field(10) });
      assert.throws(() => {
        op.execute(initialBool);
      });
    });

    it('should correctly identify isNoop vs. non-noop', () => {
      const noop = BoolOperation.noop();
      assert.strictEqual(
        noop.isNoop().toBoolean(),
        true,
        'Expected isNoop === true'
      );

      const setTo = BoolOperation.set(Bool(true));
      assert.strictEqual(
        setTo.isNoop().toBoolean(),
        false,
        'Expected isNoop === false'
      );
    });
  });

  //
  // Tests for UInt8Operation
  //
  describe('UInt8Operation', () => {
    it('should set state using set', () => {
      const op = UInt8Operation.set(UInt8.from(123));
      // Just to illustrate the structure:
      Provable.log(op);
      const newState = op.execute(initialUInt8);
      assert.strictEqual(
        newState.value.toBigInt(),
        123n,
        'State should be set to 123'
      );
    });

    it('should add using mkAdd', () => {
      const op = UInt8Operation.add(10);
      const newState = op.execute(initialUInt8); // 50 + 10 = 60
      assert.strictEqual(newState.value.toBigInt(), 60n);
    });

    it('should subtract using mkSub', () => {
      const op = UInt8Operation.sub(20);
      const newState = op.execute(initialUInt8); // 50 - 20 = 30
      assert.strictEqual(newState.value.toBigInt(), 30n);
    });

    it('should not change state using noop', () => {
      const op = UInt8Operation.noop();
      const newState = op.execute(initialUInt8);
      assert.strictEqual(
        newState.value.toBigInt(),
        50n,
        'No-op should not change the original state'
      );
    });

    it('should fail if result exceeds UInt8 range after add', () => {
      const op = UInt8Operation.add(UInt8.from(250));
      // 50 + 250 = 300 => out of range
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should fail if result is negative after subtract', () => {
      const op = UInt8Operation.sub(UInt8.from(100));
      // 50 - 100 => -50 => out of range
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should treat invalid operation code as >3 => throw', () => {
      // If operation code is > 3, we throw (assertLessThanOrEqual(3))
      const op = new UInt8Operation({
        operation: Field(99),
        value: UInt8.from(123),
      });
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should correctly identify isNoop vs. non-noop', () => {
      const noop = UInt8Operation.noop();
      assert.strictEqual(
        noop.isNoop().toBoolean(),
        true,
        'Expected isNoop === true'
      );

      const addOp = UInt8Operation.add(UInt8.from(1));
      assert.strictEqual(
        addOp.isNoop().toBoolean(),
        false,
        'Expected isNoop === false'
      );
    });

    it('should throw if provided with unsupported operation in BoolOperation test', () => {
      // Just ensuring coverage of FieldMax usage
      const op = new BoolOperation({ operation: FieldMax });
      assert.throws(() => {
        op.execute(Bool(true));
      });
    });
  });

  //
  // Tests for FieldOperation
  //
  describe('FieldOperation', () => {
    it('should set state using set', () => {
      const op = FieldOperation.set(Field(999));
      const newState = op.execute(initialField); // 100 -> 999
      assert.strictEqual(newState.toBigInt(), 999n);
    });

    it('should add using add', () => {
      const op = FieldOperation.add(Field(20));
      const newState = op.execute(initialField); // 100 + 20 => 120
      assert.strictEqual(newState.toBigInt(), 120n);
    });

    it('should subtract using sub', () => {
      const op = FieldOperation.sub(Field(50));
      const newState = op.execute(initialField); // 100 - 50 => 50
      assert.strictEqual(newState.toBigInt(), 50n);
    });

    it('should do no-op using noop', () => {
      const op = FieldOperation.noop();
      const newState = op.execute(initialField); // 100 => 100
      assert.strictEqual(newState.toBigInt(), 100n);
    });

    it('should throw on invalid operation (> 3)', () => {
      const op = new FieldOperation({
        operation: Field(10),
        value: Field(500),
      });
      assert.throws(() => {
        op.execute(initialField);
      });
    });

    it('should correctly identify isNoop vs. non-noop', () => {
      const noop = FieldOperation.noop();
      assert.strictEqual(
        noop.isNoop().toBoolean(),
        true,
        'Expected isNoop === true'
      );

      const setOp = FieldOperation.set(Field(123));
      assert.strictEqual(
        setOp.isNoop().toBoolean(),
        false,
        'Expected isNoop === false'
      );
    });
  });
});
