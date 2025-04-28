import { describe, it } from 'node:test';
import assert from 'node:assert';

import { UInt32 } from 'o1js';
import {
  MinaChainPreconditions,
  ValidityRangeUInt32,
} from '../../../../system/update/blockchain-preconditions.js';
import { requireBlockchainPreconditions } from '../../../../system/update/blockchain-state.js';

function fakeSlot(value: UInt32) {
  return {
    _value: value,
    requireBetween(first: UInt32, last: UInt32) {
      const ok = value
        .greaterThanOrEqual(first)
        .and(value.lessThanOrEqual(last))
        .toBoolean();
      assert.ok(ok, `slot ${value.toString()} outside [${first}, ${last}]`);
    },
  } as any; // Using 'any' type to satisfy the PreconditionWithRange structure
}

describe('requireBlockchainPreconditions()', () => {
  const SLOT = UInt32.from(1_000_000);

  it('accepts slot inside the given range', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotValidityRange: new ValidityRangeUInt32({
        firstValidSlot: UInt32.from(900_000),
        lastValidSlot: UInt32.from(1_100_000),
      }),
    });

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('accepts slot == firstValidSlot boundary', () => {
    const pre = MinaChainPreconditions.slotRange(SLOT, SLOT.add(100));

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('accepts slot == lastValidSlot boundary', () => {
    const pre = MinaChainPreconditions.slotRange(SLOT.sub(100), SLOT);

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('throws if slot is outside the range', () => {
    const pre = MinaChainPreconditions.slotRange(0, 999_999); // SLOT is 1_000_000

    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('accepts everything with MinaChainPreconditions.always()', () => {
    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: MinaChainPreconditions.always(),
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('throws if firstValidSlot > lastValidSlot (invalid range)', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotValidityRange: new ValidityRangeUInt32({
        firstValidSlot: UInt32.from(1_100_000),
        lastValidSlot: UInt32.from(1_000_000),
      }),
    });

    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('accepts single-value ranges (firstValidSlot == lastValidSlot)', () => {
    const pre = MinaChainPreconditions.slotRange(SLOT, SLOT);

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT),
        },
      })
    );
  });

  it('validates MinaChainPreconditions.before() utility works correctly', () => {
    // Slot before the limit should pass
    const beforePre = MinaChainPreconditions.before({ slot: 2_000_000 });
    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: beforePre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT), // 1_000_000
        },
      })
    );

    // Slot after the limit should fail
    const beforePreFail = MinaChainPreconditions.before({ slot: 500_000 });
    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: beforePreFail,
        blockchainState: {
          currentSlot: fakeSlot(SLOT), // 1_000_000
        },
      })
    );
  });

  it('validates MinaChainPreconditions.slotRange() utility works correctly', () => {
    // Slot within range should pass
    const rangePre = MinaChainPreconditions.slotRange(500_000, 1_500_000);
    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: rangePre,
        blockchainState: {
          currentSlot: fakeSlot(SLOT), // 1_000_000
        },
      })
    );

    // Slot before range should fail
    const rangePreFailLow = MinaChainPreconditions.slotRange(
      1_500_000,
      2_000_000
    );
    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: rangePreFailLow,
        blockchainState: {
          currentSlot: fakeSlot(SLOT), // 1_000_000
        },
      })
    );

    // Slot after range should fail
    const rangePreFailHigh = MinaChainPreconditions.slotRange(100_000, 500_000);
    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: rangePreFailHigh,
        blockchainState: {
          currentSlot: fakeSlot(SLOT), // 1_000_000
        },
      })
    );
  });
});
