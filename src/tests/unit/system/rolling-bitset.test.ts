import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Bool, Field, UInt32, ZkProgram } from 'o1js';
import { createRollingBitSetClasses } from '../../../system/rolling-bitset.js';

// Create classes with specific params
const BITSET_CAPACITY = 150;
const SHIFT_STEP = 50;

const {
  RollingBitSet,
  RollingBitSetPacked,
} = createRollingBitSetClasses(BITSET_CAPACITY, SHIFT_STEP);

// Helper: converts o1js Bool to JS boolean
const b = (bool: Bool) => bool.toBoolean();

// --- Test: set() ---

test('set: sets single bit in-range', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const updated = bs.set(UInt32.from(149));
  assert.equal(updated.counter.toBigint(), 1n);
  assert.ok(b(updated.has(UInt32.from(149))));
  assert.ok(!b(updated.has(UInt32.from(6))));
});

test('set: sets 0', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const updated = bs.set(UInt32.from(0));
  assert.equal(updated.counter.toBigint(), 1n);
  assert.ok(b(updated.has(UInt32.from(0))));
  assert.ok(!b(updated.has(UInt32.from(1))));
});

test('set: setting index 150 throws when shift = 0 and capacity = 150', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  assert.throws(() => {
    bs.set(UInt32.from(150)); // out of bounds: 0 + 150 = 150 (exclusive upper bound)
  });
});

// --- Test: set() two bits ---

test('set: sets two bits, same window', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const updated = bs.set(UInt32.from(5)).set(UInt32.from(6));

  assert.equal(updated.counter.toBigint(), 2n);
  assert.ok(b(updated.has(UInt32.from(5))));
  assert.ok(b(updated.has(UInt32.from(6))));
  assert.ok(!b(updated.has(UInt32.from(4))));
});

// --- Test: set with shifted window ---

test('set: shifted window works', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(10),
    bitSet: Field.from(0),
  });

  const updated = bs.set(UInt32.from(15)).set(UInt32.from(16));

  assert.equal(updated.counter.toBigint(), 2n);
  assert.ok(b(updated.has(UInt32.from(15))));
  assert.ok(b(updated.has(UInt32.from(16))));
  assert.ok(!b(updated.has(UInt32.from(14))));
});

// --- Test: setShiftOnOverflow does not shift when not needed ---

test('setShiftOnOverflow: in range, no shift occurs', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const updated = bs.setShiftOnOverflow(UInt32.from(149));

  assert.ok(b(updated.has(UInt32.from(149))));
  assert.equal(updated.shift.toBigint(), 0n);
  assert.equal(updated.counter.toBigint(), 1n);
});

// --- Test: setShiftOnOverflow shifts forward when needed ---

test('setShiftOnOverflow: shifts window when out of range', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(150),
    bitSet: Field.from(0),
  });

  // Use a number far enough to guarantee shifting occurs
  const updated = bs.setShiftOnOverflow(UInt32.from(310)); // 310 + 50 - 1 = 359 > 150 + 201 = 351

  assert.ok(b(updated.has(UInt32.from(310))));
  assert.ok(updated.shift.toBigint() > 150n);
  assert.equal(updated.counter.toBigint(), 1n);
});

// --- Test: multiple setShiftOnOverflow calls across shifts ---

test('setShiftOnOverflow: handles multiple shift-triggering inserts', () => {
  let bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  bs = bs.setShiftOnOverflow(UInt32.from(150));
  const shift1 = bs.shift.toBigint();
  assert.ok(b(bs.has(UInt32.from(150))));

  bs = bs.setShiftOnOverflow(UInt32.from(200)); // Triggers another shift
  const shift2 = bs.shift.toBigint();
  assert.ok(b(bs.has(UInt32.from(200))));
  assert.ok(shift2 > shift1);
  assert.equal(bs.counter.toBigint(), 2n);
});

test('setShiftOnOverflow: throws if index is still out of bounds after one shift', () => {
  const { RollingBitSet } = createRollingBitSetClasses(150, 50);

  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  // Index 201 is out of range even after a single shift (max is 200)
  assert.throws(() => {
    bs.setShiftOnOverflow(UInt32.from(201));
  });
});



// --- Test: pack() and unpack() roundtrip ---

test('pack/unpack roundtrip preserves data', () => {
  let bs = new RollingBitSet({
    counter: UInt32.from(2),
    shift: UInt32.from(100),
    bitSet: Field.from(0),
  });

  bs = bs.set(UInt32.from(105));

  const packed = bs.pack();
  assert.ok(packed instanceof RollingBitSetPacked);

  const unpacked = packed.unpack();
  assert.ok(b(unpacked.has(UInt32.from(105))));
  assert.equal(unpacked.counter.toBigint(), bs.counter.toBigint());
  assert.equal(unpacked.shift.toBigint(), bs.shift.toBigint());
});
// --- Test: pack of default struct is consistent ---

test('pack: default struct produces a Field with expected bit length', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const packed = bs.pack().rollingBitSetPacked;

  // There should be exactly 254 meaningful bits encoded (32 + 31 + 150)
  const bits = packed.toBits(254);
  assert.equal(bits.length, 254);
});

// --- Test: unpack of packed empty struct matches original ---

test('unpack: round-trip for default struct matches original', () => {
  const original = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  const packed = original.pack();
  const unpacked = packed.unpack();

  assert.equal(unpacked.counter.toBigint(), 0n);
  assert.equal(unpacked.shift.toBigint(), 0n);
  assert.ok(unpacked.bitSet.equals(Field.from(0)).toBoolean());
});

// --- Test: pack/unpack after multiple .set() calls ---

test('pack/unpack: after multiple set calls retains bits', () => {
  let bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });

  bs = bs.set(UInt32.from(5)).set(UInt32.from(6)).set(UInt32.from(10));
  const packed = bs.pack();
  const unpacked = packed.unpack();

  assert.ok(b(unpacked.has(UInt32.from(5))));
  assert.ok(b(unpacked.has(UInt32.from(6))));
  assert.ok(b(unpacked.has(UInt32.from(10))));
  assert.ok(!b(unpacked.has(UInt32.from(4))));
  assert.equal(unpacked.counter.toBigint(), 3n);
});

// --- Test: pack/unpack preserves custom shift and counter ---

test('pack/unpack: custom shift + counter preserved', () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(42),
    shift: UInt32.from(77),
    bitSet: Field.from(2 ** 5), // only bit 5 set
  });

  const packed = bs.pack();
  const unpacked = packed.unpack();

  assert.equal(unpacked.counter.toBigint(), 42n);
  assert.equal(unpacked.shift.toBigint(), 77n);
  assert.ok(b(unpacked.has(UInt32.from(82)))); // shift + 5
  assert.ok(!b(unpacked.has(UInt32.from(81))));
});

// --- Test: setting the final possible bit and roundtrip ---

test('pack/unpack: last valid bit in range is preserved', () => {
  const lastBit = UInt32.from(BITSET_CAPACITY - 1); // 149
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  }).set(lastBit);

  const packed = bs.pack();
  const unpacked = packed.unpack();

  assert.ok(b(unpacked.has(lastBit)));
  assert.equal(unpacked.counter.toBigint(), 1n);
});

/// provable tests
// Define program
const program = ZkProgram({
  name: 'TestRollingBitSet',
  publicInput: RollingBitSetPacked,
  publicOutput: RollingBitSetPacked,
  methods: {
    set: {
      privateInputs: [UInt32],
      async method(
        bitset: InstanceType<typeof RollingBitSetPacked>,
        number: UInt32
      ): Promise<{ publicOutput: InstanceType<typeof RollingBitSetPacked> }> {
        const bs = bitset.unpack().setShiftOnOverflow(number).pack();
        return {
          publicOutput: bs,
        };
      },
    },

    has: {
      privateInputs: [UInt32],
      async method(
        bitset: InstanceType<typeof RollingBitSetPacked>,
        number: UInt32
      ): Promise<{publicOutput: InstanceType<typeof RollingBitSetPacked>}> {
        const result = bitset.unpack().has(number);
        result.assertTrue();
        return {
          publicOutput: bitset,
        };
      },
    },
  },
});

await program.compile();


// ⏱️ Helper: log and time something
const timed = async (label: string, fn: () => Promise<any>) => {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  console.log(`${label} took ${(end - start).toFixed(2)}ms`);
  return result;
};

// ✅ Test proving normal .set()
test('zkprogram: set: sets single bit in-range', async () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(0),
    bitSet: Field.from(0),
  });
  const bsp = bs.pack();

  const proof = await timed('Proving set()', () =>
    program.set(bsp, UInt32.from(49))
  );

  await proof.proof.verify();

  const updated = proof.proof.publicOutput.unpack();
  assert.equal(updated.counter.toBigint(), 1n);
  assert.ok(b(updated.has(UInt32.from(49))));
  assert.ok(!b(updated.has(UInt32.from(6))));
});

// ✅ Test proving .setShiftOnOverflow()
test('zkprogram: setShiftOnOverflow shifts & proves correctly', async () => {
  const bs = new RollingBitSet({
    counter: UInt32.from(0),
    shift: UInt32.from(100),
    bitSet: Field.from(0),
  });
  const bsp = bs.pack();

  // Use a number guaranteed to trigger a shift
  const overflowIndex = UInt32.from(255);

  // Patch: simulate a version of setShiftOnOverflow inside the zk method
  const { proof } = await timed('Proving setShiftOnOverflow()', async () => {
    return program.set(bsp, overflowIndex); // dummy second arg (won’t affect)
  });

  await proof.verify();
  const result = proof.publicOutput.unpack();

  // Assertions: index was added, counter incremented, shift changed
  assert.ok(b(result.has(overflowIndex)));
  assert.ok(result.shift.toBigint() > 100n);
  assert.equal(result.counter.toBigint(), 1n);
});
