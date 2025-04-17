import { describe, it } from 'node:test';
import assert from 'node:assert';

import { UInt32 } from 'o1js';
import {
  MinaChainPreconditions,
  ValidityRangeUInt32,
} from '../../../../system/update/blockchain-preconditions.js';
import { requireBlockchainPreconditions } from '../../../../system/update/blockchain-state.js';

function fakeCurrentSlot(value: UInt32) {
  return {
    _value: value,
    requireBetween(first: UInt32, last: UInt32) {
      const ok = value
        .greaterThanOrEqual(first)
        .and(value.lessThanOrEqual(last))
        .toBoolean();
      assert.ok(
        ok,
        `currentSlot ${value.toString()} outside [${first}, ${last}]`
      );
    },
  } as unknown as import('o1js/dist/node/lib/mina/precondition').CurrentSlot;
}

describe('requireBlockchainPreconditions()', () => {
  const SLOT = UInt32.from(1_000);
  const LEN = UInt32.from(50_000);

  it('accepts slot & length inside the given range', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(900),
        lastValidBlock: UInt32.from(1_100),
      }),
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(49_000),
        lastValidBlock: UInt32.from(51_000),
      }),
    });

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts slot == firstValidBlock boundary', () => {
    const pre = MinaChainPreconditions.blockchainLength();
    pre.slotIndexValidityRange = new ValidityRangeUInt32({
      firstValidBlock: SLOT,
      lastValidBlock: SLOT.add(100),
    });

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts slot == lastValidBlock boundary', () => {
    const pre = MinaChainPreconditions.blockchainLength();
    pre.slotIndexValidityRange = new ValidityRangeUInt32({
      firstValidBlock: SLOT.sub(100),
      lastValidBlock: SLOT,
    });

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts blockchainLength == firstValidBlock', () => {
    const pre = MinaChainPreconditions.blockchainLength(
      LEN,
      LEN.add(UInt32.from(1000))
    );

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts blockchainLength == lastValidBlock', () => {
    const pre = MinaChainPreconditions.blockchainLength(
      LEN.sub(UInt32.from(1000)),
      LEN
    );

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('throws if currentSlot is outside the range', () => {
    const pre = MinaChainPreconditions.blockchainLength();
    pre.slotIndexValidityRange = new ValidityRangeUInt32({
      firstValidBlock: UInt32.from(0),
      lastValidBlock: UInt32.from(999),
    });

    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('throws if blockchainLength is outside the range', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.MAXINT(),
      }),
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(60_000),
        lastValidBlock: UInt32.from(70_000),
      }),
    });

    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts everything with MinaChainPreconditions.always()', () => {
    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: MinaChainPreconditions.always(),
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('throws if firstValidBlock > lastValidBlock (invalid range)', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(1100),
        lastValidBlock: UInt32.from(1000),
      }),
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.MAXINT(),
      }),
    });

    assert.throws(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });

  it('accepts single-value ranges (firstValid == lastValid)', () => {
    const pre = MinaChainPreconditions.blockchainLength();
    pre.slotIndexValidityRange = new ValidityRangeUInt32({
      firstValidBlock: SLOT,
      lastValidBlock: SLOT,
    });

    assert.doesNotThrow(() =>
      requireBlockchainPreconditions({
        preconditions: pre,
        blockchainState: {
          currentSlot: fakeCurrentSlot(SLOT),
          blockchainLength: LEN,
        },
      })
    );
  });
  it('fails if only blockchainLength is out of range, even when currentSlot is ok', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(900),
        lastValidBlock: UInt32.from(1_100),
      }),
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(60_000), // LEN = 50_000, so outside
        lastValidBlock: UInt32.from(70_000),
      }),
    });

    assert.throws(
      () =>
        requireBlockchainPreconditions({
          preconditions: pre,
          blockchainState: {
            currentSlot: fakeCurrentSlot(SLOT),
            blockchainLength: LEN,
          },
        }),
      'Expected blockchainLength to fail but it did not'
    );
  });

  it('fails if only currentSlot is out of range, even when blockchainLength is ok', () => {
    const pre: MinaChainPreconditions = new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(500),
      }), // SLOT = 1000, so outside
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(49_000),
        lastValidBlock: UInt32.from(51_000),
      }),
    });

    assert.throws(
      () =>
        requireBlockchainPreconditions({
          preconditions: pre,
          blockchainState: {
            currentSlot: fakeCurrentSlot(SLOT),
            blockchainLength: LEN,
          },
        }),
      'Expected currentSlot to fail but it did not'
    );
  });
});
