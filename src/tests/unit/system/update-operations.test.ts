import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  Bool,
  Field,
  Provable,
  UInt8,
} from 'o1js';
import { BoolOperation, FieldMax, UInt8Operation } from '../../../system/update/simple-operations';

describe('Operation Classes Test Suite', () => {
  //
  // Common variables, re-instantiated before each test.
  //
  let initialBool: Bool;
  let initialUInt8: UInt8;

  beforeEach(() => {
    initialBool = Bool(false); // reset for each test
    initialUInt8 = UInt8.from(50);
  });

  //
  // Tests for BoolOperation
  //
  describe('BoolOperation', () => {
    it('should set state to true using mkSetTo(true)', () => {
      const op = BoolOperation.mkSetTo(Bool(true));
      const newState = op.execute(initialBool);
      assert.strictEqual(newState.toBoolean(), true);
    });

    it('should set state to false using mkSetTo(false)', () => {
      const op = BoolOperation.mkSetTo(Bool(false));
      const newState = op.execute(Bool(true));
      assert.strictEqual(newState.toBoolean(), false);
    });

    it('should flip the state using mkFlip', () => {
      const op = BoolOperation.mkFlip();
      // flipping from false => true
      const newState = op.execute(initialBool);
      assert.strictEqual(newState.toBoolean(), true);

      // flipping again => false
      const newState2 = op.execute(newState);
      assert.strictEqual(newState2.toBoolean(), false);
    });

    it('should no-op the state if operation=3 (mkNoop)', () => {
      const op = BoolOperation.mkNoop();
      // This returns 3 => we do not change the state
      const newState = op.execute(Bool(true));
      assert.strictEqual(newState.toBoolean(), true, 'No-op should not change state');
      const newState2 = op.execute(initialBool);
      assert.strictEqual(newState2.toBoolean(), false, 'No-op should not change state');
    });

    it('should throw on invalid operation', () => {
      const op = new BoolOperation({ operation: Field(10) });
      assert.throws(() => {
        op.execute(initialBool);
      });
    });
  });

  //
  // Tests for UInt8Operation
  //
  describe('UInt8Operation', () => {
    it('should set state using mkSetTo', () => {
      const op = UInt8Operation.mkSetTo(UInt8.from(123));
      Provable.log(op);
      const newState = op.execute(initialUInt8);
      assert.strictEqual(newState.value.toBigInt(), 123n, 'State should be set to 123');
    });

    it('should add using mkAdd', () => {
      const op = UInt8Operation.mkAdd(UInt8.from(10));
      const newState = op.execute(initialUInt8); // 50 + 10 = 60
      assert.strictEqual(newState.value.toBigInt(), 60n);
    });

    it('should subtract using mkSub', () => {
      const op = UInt8Operation.mkSub(UInt8.from(20));
      const newState = op.execute(initialUInt8); // 50 - 20 = 30
      assert.strictEqual(newState.value.toBigInt(), 30n);
    });

    it('should not change state using mkNoop', () => {
      const op = UInt8Operation.mkNoop();
      const newState = op.execute(initialUInt8);
      assert.strictEqual(newState.value.toBigInt(), 50n, 'No-op should not change the original state');
    });

    it('should fail if result exceeds UInt8 range after add', () => {
      const op = UInt8Operation.mkAdd(UInt8.from(250));
      // 50 + 250 = 300 => out of range
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should fail if result is negative after subtract', () => {
      const op = UInt8Operation.mkSub(UInt8.from(100));
      // 50 - 100 => -50 => out of range
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should treat invalid operation code as no-op', () => {
      // If operation code is > 3, your code ends up in the final else => no-op 
      const op = new UInt8Operation({
        operation: Field(99),
        value: UInt8.from(123),
      });
      assert.throws(() => {
        op.execute(initialUInt8);
      });
    });

    it('should throw if provided with unsupported operation', () => {
      // Checking that FieldMax isn't used in the code directly except as a reference,
      // we can e.g. do an operation with FieldMax
      const op = new BoolOperation({ operation: FieldMax });
      // FieldMax >> 3 => default branch => no-op
      assert.throws(() => {
        op.execute(Bool(true));
      });
    });
  });
});
