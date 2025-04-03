import { Struct, Field, UInt32, Bool, Provable } from 'o1js';
import { Gadgets } from 'o1js';

/**
 * Creates a parametric RollingBitSet & RollingBitSetPacked
 * for a given bitsetCapacity + shiftStep.
 *
 * Usage:
 *   const { RollingBitSet, RollingBitSetPacked } = createRollingBitSetClasses(150, 50);
 *   let bs = new RollingBitSet({ counter, shift, bitSet: Field.from(0) });
 *   ...
 */
export function createRollingBitSetClasses(bitsetCapacity: number, shiftStep: number) {
  // Validate constraints
  const counterBits = 32;
  const shiftBits = 31;
  const maxBitsetBits = 254 - counterBits - shiftBits; // total bits in a Field minus overhead

  if (bitsetCapacity > maxBitsetBits) {
    throw new Error(`Bitset capacity exceeds maximum of ${maxBitsetBits} bits`);
  }
  if (shiftStep > maxBitsetBits - 1) {
    throw new Error(`Shift step exceeds maximum of ${maxBitsetBits - 1} bits`);
  }

  // 1) Define RollingBitSet class
  class RollingBitSetClass extends Struct({
    counter: UInt32,
    shift: UInt32,
    bitSet: Field,
  }) {
    static COUNTER_BITS = counterBits;
    static SHIFT_BITS = shiftBits;
    static BITSET_BITS = bitsetCapacity;
    static SHIFT_STEP = shiftStep;

    packField(): Field {
      return Field.fromBits([
        ...this.counter.value.toBits(RollingBitSetClass.COUNTER_BITS),
        ...this.shift.value.toBits(RollingBitSetClass.SHIFT_BITS),
        ...this.bitSet.toBits(RollingBitSetClass.BITSET_BITS),
      ]);
    }

    /**
     * pack() -> instance of RollingBitSetPackedClass
     */
    pack(): InstanceType<typeof RollingBitSetPackedClass> {
      return new RollingBitSetPackedClass({
        rollingBitSetPacked: this.packField(),
      });
    }

    static unpack(packedBitset: Field): RollingBitSetClass {
      const TOTAL_BITS = 254;
      const bits = packedBitset.toBits(TOTAL_BITS);

      let offset = 0;
      function readBits(length: number) {
        const slice = bits.slice(offset, offset + length);
        offset += length;
        return slice;
      }

      const counterBitsArr = readBits(RollingBitSetClass.COUNTER_BITS);
      const shiftBitsArr = readBits(RollingBitSetClass.SHIFT_BITS);
      const bitSetBitsArr = readBits(RollingBitSetClass.BITSET_BITS);

      const counter = UInt32.Unsafe.fromField(Field.fromBits(counterBitsArr));
      const shift = UInt32.Unsafe.fromField(Field.fromBits(shiftBitsArr));
      const bitSet = Field.fromBits(bitSetBitsArr);

      return new RollingBitSetClass({ counter, shift, bitSet });
    }

    has(n: UInt32): Bool {
      const max = this.shift.add(RollingBitSetClass.BITSET_BITS).sub(1);
      n.assertLessThanOrEqual(
        max,
        'Index ${n} out of bounds. Current maximum ${max}'
      );

      const min = this.shift;
      n.assertGreaterThanOrEqual(
        min,
        'Index ${n} out of bounds. Current minimum ${min}'
      );

      const offset = n.sub(min);
      let offsetCounter = Field(0);
      let andMask = Field(1);

      for (let i = 0; i < RollingBitSetClass.BITSET_BITS; i++) {
        andMask = Provable.if(
          offsetCounter.lessThan(offset.value),
          Gadgets.leftShift32(andMask, 1),
          andMask
        );
        offsetCounter = offsetCounter.add(1);
      }

      const bitSetValue = Gadgets.and(this.bitSet, andMask, RollingBitSetClass.BITSET_BITS);
      return bitSetValue.equals(andMask);
    }

    set(n: UInt32): RollingBitSetClass {
      const max = this.shift.add(RollingBitSetClass.BITSET_BITS).sub(1);
      n.assertLessThanOrEqual(
        max,
        'Value too big. Adjust the bitset shift.'
      );

      const min = this.shift;
      n.assertGreaterThanOrEqual(
        min,
        'Value too small. Adjust the bitset shift.'
      );

      const offset = n.sub(min);
      let offsetCounter = Field(0);
      let setMask = Field(1);

      for (let i = 0; i < RollingBitSetClass.BITSET_BITS; i++) {
        setMask = Provable.if(
          offsetCounter.lessThan(offset.value),
          Gadgets.leftShift32(setMask, 1),
          setMask
        );
        offsetCounter = offsetCounter.add(1);
      }

      const newBitSet = Gadgets.or(this.bitSet, setMask, RollingBitSetClass.BITSET_BITS);
      const newCounter = this.counter.add(1);

      return new RollingBitSetClass({
        counter: newCounter,
        shift: this.shift,
        bitSet: newBitSet,
      });
    }

    /**
     * setShiftOnOverflow(n):
     * If `n + SHIFT_STEP - 1` exceeds the current window, shift forward by SHIFT_STEP,
     * then set(n). Increments counter.
     */
    setShiftOnOverflow(n: UInt32): RollingBitSetClass {
      const step = RollingBitSetClass.SHIFT_STEP;
      const bitsetSize = RollingBitSetClass.BITSET_BITS;

      const neededMax = n;
      const currentMax = this.shift.add(bitsetSize).sub(1);
      const outOfRange = neededMax.greaterThan(currentMax);

      const newShiftValue = Provable.if(
        outOfRange,
        this.shift.value.add(step),
        this.shift.value
      );

      const shiftedBitSet = Gadgets.leftShift32(this.bitSet, step);
      const finalBitSet = Provable.if(outOfRange, shiftedBitSet, this.bitSet);

      const interim = new RollingBitSetClass({
        counter: this.counter,
        shift: UInt32.Unsafe.fromField(newShiftValue),
        bitSet: finalBitSet,
      });

      return interim.set(n);
    }
  }

  // 2) Define RollingBitSetPacked class
  class RollingBitSetPackedClass extends Struct({
    rollingBitSetPacked: Field,
  }) {
    /**
     * Unpack -> instance of RollingBitSetClass
     */
    unpack(): RollingBitSetClass {
      return RollingBitSetClass.unpack(this.rollingBitSetPacked);
    }
  }

  // Return both classes
  return {
    RollingBitSet: RollingBitSetClass,
    RollingBitSetPacked: RollingBitSetPackedClass,
  };
}
