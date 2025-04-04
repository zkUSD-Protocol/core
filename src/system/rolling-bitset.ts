// TODO To be moved outside of the repository for now
// import { Struct, Field, UInt32, Bool, Provable, UInt8 } from 'o1js';
// import { Gadgets } from 'o1js';

// /**
//  * Creates a parametric RollingBitSet & RollingBitSetPacked
//  * for a given bitsetCapacity + shiftStep.
//  *
//  * Usage:
//  *   const { RollingBitSet, RollingBitSetPacked } = createRollingBitSetClasses(150, 50);
//  *   let bs = new RollingBitSet({ counter, shift, bitSet: Field.from(0) });
//  *   ...
//  */
// export function createRollingBitSetClasses(bitsetCapacity: number, shiftStep: number) {
//   // Validate constraints
//   const counterBits = 32;
//   const shiftBits = 31;
//   const highestNumberSetBits = 8;
//   const maxBitsetBits = 254 - counterBits - shiftBits - highestNumberSetBits; // total bits in a Field minus overhead

//   if (bitsetCapacity > maxBitsetBits) {
//     throw new Error(`Bitset capacity exceeds maximum of ${maxBitsetBits} bits`);
//   }
//   if (shiftStep > maxBitsetBits - 1) {
//     throw new Error(`Shift step exceeds maximum of ${maxBitsetBits - 1} bits`);
//   }

//   // 1) Define RollingBitSet class
//   class RollingBitSetClass extends Struct({
//     counter: UInt32,
//     shift: UInt32,
//     highest: UInt8,
//     bitSet: Field,
//   }) {
//     static COUNTER_BITS = counterBits;
//     static SHIFT_BITS = shiftBits;
//     static HIGHEST_BITS = highestNumberSetBits;
//     static BITSET_BITS = bitsetCapacity;
//     static SHIFT_STEP = shiftStep;

//     static empty(): RollingBitSetClass {
//       return new RollingBitSetClass({
//         counter: UInt32.from(0),
//         shift: UInt32.from(0),
//         highest: UInt8.from(0),
//         bitSet: Field.from(0),
//       });
//     }

//     packField(): Field {
//       return Field.fromBits([
//         ...this.counter.value.toBits(RollingBitSetClass.COUNTER_BITS),
//         ...this.shift.value.toBits(RollingBitSetClass.SHIFT_BITS),
//         ...this.highest.value.toBits(RollingBitSetClass.HIGHEST_BITS),
//         ...this.bitSet.toBits(RollingBitSetClass.BITSET_BITS),
//       ]);
//     }

//     /**
//      * pack() -> instance of RollingBitSetPackedClass
//      */
//     pack(): InstanceType<typeof RollingBitSetPackedClass> {
//       return new RollingBitSetPackedClass({
//         rollingBitSetPacked: this.packField(),
//       });
//     }

//     static unpack(packedBitset: Field): RollingBitSetClass {
//       const TOTAL_BITS = 254;
//       const bits = packedBitset.toBits(TOTAL_BITS);

//       let offset = 0;
//       function readBits(length: number) {
//         const slice = bits.slice(offset, offset + length);
//         offset += length;
//         return slice;
//       }

//       const counterBitsArr = readBits(RollingBitSetClass.COUNTER_BITS);
//       const shiftBitsArr = readBits(RollingBitSetClass.SHIFT_BITS);
//       const highestBitsArr = readBits(RollingBitSetClass.HIGHEST_BITS);
//       const bitSetBitsArr = readBits(RollingBitSetClass.BITSET_BITS);

//       const counter = UInt32.Unsafe.fromField(Field.fromBits(counterBitsArr));
//       const shift = UInt32.Unsafe.fromField(Field.fromBits(shiftBitsArr));
//       const highest = UInt8.Unsafe.fromField(Field.fromBits(highestBitsArr));
//       const bitSet = Field.fromBits(bitSetBitsArr);

//       return new RollingBitSetClass({ counter, shift, highest, bitSet });
//     }

//     has(n: UInt32): Bool {
//       const max = this.shift.add(RollingBitSetClass.BITSET_BITS).sub(1);
//       n.assertLessThanOrEqual(
//         max,
//         'The number is too high. Consult the bitset shift.'
//       );

//       const min = this.shift;
//       n.assertGreaterThanOrEqual(
//         min,
//         'The number is too low. Consult the bitset shift.'
//       );

//       const offset = n.sub(min);
//       let offsetCounter = Field(0);
//       let andMask = Field(1);

//       for (let i = 0; i < RollingBitSetClass.BITSET_BITS; i++) {
//         andMask = Provable.if(
//           offsetCounter.lessThan(offset.value),
//           Gadgets.leftShift32(andMask, 1),
//           andMask
//         );
//         offsetCounter = offsetCounter.add(1);
//       }

//       const bitSetValue = Gadgets.and(this.bitSet, andMask, RollingBitSetClass.BITSET_BITS);
//       return bitSetValue.equals(andMask);
//     }

//     set(n: UInt32): RollingBitSetClass {
//       const max = this.shift.add(RollingBitSetClass.BITSET_BITS).sub(1);
//       n.assertLessThanOrEqual(
//         max,
//         'Value too big. Adjust the bitset shift.'
//       );

//       const min = this.shift;
//       n.assertGreaterThanOrEqual(
//         min,
//         'Value too small. Adjust the bitset shift.'
//       );

//       const offset = n.sub(min);
//       let offsetCounter = Field(0);
//       let setMask = Field(1);

//       for (let i = 0; i < RollingBitSetClass.BITSET_BITS; i++) {
//         setMask = Provable.if(
//           offsetCounter.lessThan(offset.value),
//           Gadgets.leftShift32(setMask, 1),
//           setMask
//         );
//         offsetCounter = offsetCounter.add(1);
//       }

//       const newBitSet = Gadgets.or(this.bitSet, setMask, RollingBitSetClass.BITSET_BITS);
//       const newCounter = this.counter.add(1);

//       const maybeNewHighest = n.sub(this.shift);

//       const highest = Provable.if(
//         maybeNewHighest.greaterThan(this.highest.toUInt32()),
//         maybeNewHighest,
//         this.highest.toUInt32()
//       );
//       highest.assertLessThan(
//         UInt32.from(RollingBitSetClass.BITSET_BITS),
//         "This is most likely a bug. The highest number set is out of bounds. Please report this issue."
//       );

//       return new RollingBitSetClass({
//         counter: newCounter,
//         highest: UInt8.Unsafe.fromField(highest.value),
//         shift: this.shift,
//         bitSet: newBitSet,
//       });
//     }



//     isTooBig(n: UInt32): Bool {
//       const capacity = this.shift.add(RollingBitSetClass.BITSET_BITS).add(RollingBitSetClass.SHIFT_STEP);
//       return n.greaterThanOrEqual(capacity);
//     }

//     isTooSmall(n: UInt32): Bool {
//       const capacity = this.shift;
//       return n.lessThan(capacity);
//     }

//     /**
//      * getHighestNumberSetOrMinimal():
//      * Returns the highest number set or the minimal value of the current window,
//      * whichever is greater.
//      */
//     getHighestNumberSetOrMinimal(): UInt32 {
//       // current shift plus the highest
//       return this.shift.add(this.highest.toUInt32());
//     }

//     /**
//      * setShiftOnOverflow(n):
//      * If `n + SHIFT_STEP - 1` exceeds the current window, shift forward by SHIFT_STEP,
//      * then set(n). Increments counter.
//      */
//     setShiftOnOverflow(n: UInt32): RollingBitSetClass {
//       const step = RollingBitSetClass.SHIFT_STEP;
//       const bitsetSize = RollingBitSetClass.BITSET_BITS;

//       const neededMax = n;
//       const currentMax = this.shift.add(bitsetSize).sub(1);
//       const outOfRange = neededMax.greaterThan(currentMax);

//       const newShiftValue = Provable.if(
//         outOfRange,
//         this.shift.value.add(step),
//         this.shift.value
//       );

//       const shiftedBitSet = Gadgets.leftShift32(this.bitSet, step);
//       const finalBitSet = Provable.if(outOfRange, shiftedBitSet, this.bitSet);

//       // the step is known to be less than 200
//       // so we can safely use UInt8
//       // if the current highest index is lower than the step
//       // we just zero it.
//       const newHighest = UInt8.Unsafe.fromField(Provable.if(
//         this.highest.greaterThan(UInt8.from(step)),
//         this.highest.value.sub(step),
//         Field.from(0)
//       ));

//       const interim = new RollingBitSetClass({
//         counter: this.counter,
//         shift: UInt32.Unsafe.fromField(newShiftValue),
//         highest: newHighest,
//         bitSet: finalBitSet,
//       });

//       return interim.set(n);
//     }
//   }

//   // 2) Define RollingBitSetPacked class
//   class RollingBitSetPackedClass extends Struct({
//     rollingBitSetPacked: Field,
//   }) {
//     static empty(): RollingBitSetPackedClass {
//       return RollingBitSetClass.empty().pack();
//     }

//     /**
//      * Unpack -> instance of RollingBitSetClass
//      */
//     unpack(): RollingBitSetClass {
//       return RollingBitSetClass.unpack(this.rollingBitSetPacked);
//     }
//   }

//   // Return both classes
//   return {
//     RollingBitSet: RollingBitSetClass,
//     RollingBitSetPacked: RollingBitSetPackedClass,
//   };
// }


/**
 * Ensures the provided update proof has not been used, marks it as used, and returns the updated bitset.
 * It may so happen that the proof its gov resolution index is too small or too big to shift forward.
 * Assume the following: `GovResolutionBufferCapacity = 4` and `GovResolutionShiftBufferStep = 2`,
 * Resolutions with indices 0,1,x,3 were already set, and you setting one with index 5.
 * After the operation the bitset buffer will contain: x,3,x,5.
 * If you tried to set 6 it would have failed. 6 >= 4+2.
 */
// export function computeResolutionProofNullifier(
//   resolutionProof: ZkusdProtocolUpdateProof,
//   currentBitset: RollingBitSetPacked,
// ): RollingBitSetPacked {

//   const index = resolutionProof.publicInput.govResolutionIndex;

//   const rb = currentBitset.unpack();

//   rb.isTooSmall(index).assertFalse(
//     "The resolution index is too small to be used. Check the current nullifier buffer shift.");

//   rb.isTooBig(index).assertFalse(
//     "The resolution index is too big to be used. Check the current nullifier buffer shift.");

//   const ret = rb.setShiftOnOverflow(index).pack();

//   return ret;
// }

    // /**
    //  * Ensures the provided update proof has not been used, marks it as used, and returns the updated Merkle root.
    //  * Enforces strict sequential usage (e.g., index 2 only after index 1 is used).
    //  */
    // applyResolutionProof(
    //   resolutionProof: ZkusdProtocolUpdateProof,
    // ) {
    //   const nullifierBitset = this.govResolutionNullifierBitset.getAndRequireEquals();

    //   const newNullifierBitSet = computeResolutionProofNullifier(
    //     resolutionProof,
    //     nullifierBitset
    //   );
    //   Provable.log("New nullifier bitset root hash: ", newNullifierBitSet.rollingBitSetPacked);

    //   this.govResolutionNullifierBitset.set(newNullifierBitSet);
    // }
