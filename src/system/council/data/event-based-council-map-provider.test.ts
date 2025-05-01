import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Field, UInt32, Bool, PublicKey } from 'o1js';

import { CouncilMap } from './council-map.js';
import { ZkusdGoverningCouncilContract } from '../../../contracts/zkusd-governing-council.js';
import { CouncilUpdateActionEvent } from '../events.js';
import { CouncilUpdateActions, CouncilUpdateOperation } from '../update/common.js';
import { Seat } from '../seat.js';
import { CouncilMapContractEventsProvider } from './event-based-council-map-provider.js';

/* -------------------------------------------------------------------------- */
/*                              Helper Functions                              */
/* -------------------------------------------------------------------------- */

function createFakeRoot(): Field {
  const root = {
    equals: (other: any) => ({ toBoolean: () => other === root }),
  };
  return root as unknown as Field;
}

function makeCouncilActionEvent(
  memberId: number,
  blockHeight = 0
): {
  type: 'CouncilUpdateActionEvent';
  blockHeight: UInt32;
  event: { data: CouncilUpdateActionEvent };
} {
  const pubKey = PublicKey.fromFields([Field(memberId), Field(0)]);
  const op = new CouncilUpdateOperation({
    member: pubKey,
    seat: Seat.fromIndex(memberId),
    shouldAdd: Bool(true),
    isDummy: Bool(false),
  });

  const padded = [op, ...Array(9).fill(CouncilUpdateOperation.dummy())];

  const eventData = new CouncilUpdateActionEvent({ action: op });

  return {
    type: 'CouncilUpdateActionEvent',
    blockHeight: UInt32.from(blockHeight),
    event: { data: eventData },
  };
}

/* -------------------------------------------------------------------------- */
/*                                #get() suite                                */
/* -------------------------------------------------------------------------- */

describe('CouncilMapContractEventsProvider#get()', () => {
  it('returns cached map when synced', async () => {
    const root = createFakeRoot();
    const map = { root } as CouncilMap;

    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => UInt32.from(0)
    );
    (provider as any).councilMap = map;

    const result = await provider.get();
    assert.strictEqual(result, map);
  });

  it('refreshes when map is missing', async () => {
    const root = createFakeRoot();
    const newMap = { root } as CouncilMap;

    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => UInt32.from(0)
    );

    (provider as any).refresh = async () => {
      (provider as any).councilMap = newMap;
    };

    const result = await provider.get();
    assert.strictEqual(result, newMap);
  });

  it('refreshes stale map and succeeds', async () => {
    const oldRoot = createFakeRoot();
    const newRoot = createFakeRoot();

    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => newRoot,
      async () => UInt32.from(0)
    );

    (provider as any).councilMap = { root: oldRoot };
    (provider as any).refresh = async () => {
      (provider as any).councilMap = { root: newRoot };
    };

    const result = await provider.get();
    assert.strictEqual(result.root, newRoot);
  });

  it('throws when still out of sync after refresh', async () => {
    const r1 = createFakeRoot();
    const r2 = createFakeRoot();
    const chainRoot = createFakeRoot();

    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => chainRoot,
      async () => UInt32.from(0)
    );

    (provider as any).councilMap = { root: r1 };
    (provider as any).refresh = async () => {
      (provider as any).councilMap = { root: r2 };
    };

    await assert.rejects(provider.get(), /does not match the onchain state/i);
  });
});

/* -------------------------------------------------------------------------- */
/*                           #matchesOnchainRoot()                            */
/* -------------------------------------------------------------------------- */

describe('CouncilMapContractEventsProvider#matchesOnchainRoot()', () => {
  it('throws if map missing', async () => {
    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => createFakeRoot(),
      async () => UInt32.from(0)
    );
    await assert.rejects(provider.matchesOnchainRoot(), /no root available/);
  });

  it('throws if fetchOnchainRoot fails', async () => {
    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => null as any },
      async () => null as any,
      async () => UInt32.from(0)
    );
    (provider as any).councilMap = { root: createFakeRoot() };
    await assert.rejects(
      provider.matchesOnchainRoot(),
      /cannot fetch proposal map root/i
    );
  });

  it('returns true when roots match', async () => {
    const root = createFakeRoot();
    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => UInt32.from(0)
    );
    (provider as any).councilMap = { root };
    assert.strictEqual(await provider.matchesOnchainRoot(), true);
  });

  it('returns false when roots differ', async () => {
    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => createFakeRoot(),
      async () => UInt32.from(0)
    );
    (provider as any).councilMap = { root: createFakeRoot() };
    assert.strictEqual(await provider.matchesOnchainRoot(), false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                 #refresh()                                 */
/* -------------------------------------------------------------------------- */

describe('CouncilMapContractEventsProvider#refresh()', () => {
  it('fetches events and rebuilds map', async () => {
    const events = [makeCouncilActionEvent(1)];

    const provider = new CouncilMapContractEventsProvider(
      { fetchEvents: async () => events } as any,
      async () => createFakeRoot(),
      async () => UInt32.from(0)
    );

    let rebuildCalled = false;
    const original = CouncilMapContractEventsProvider.rebuildCouncilMerkleMap;

    (CouncilMapContractEventsProvider as any).rebuildCouncilMerkleMap = (
      ev: any
    ) => {
      rebuildCalled = true;
      assert.strictEqual(ev, events);
      return { root: createFakeRoot() } as CouncilMap;
    };

    try {
      await provider.refresh();
      assert.ok(rebuildCalled);
    } finally {
      (CouncilMapContractEventsProvider as any).rebuildCouncilMerkleMap =
        original;
    }
  });

  it('propagates fetchEvents() errors', async () => {
    const provider = new CouncilMapContractEventsProvider(
      {
        fetchEvents: async () => {
          throw new Error('boom');
        },
      } as any,
      async () => createFakeRoot(),
      async () => UInt32.from(0)
    );
    await assert.rejects(provider.refresh(), /boom/);
  });
});

/* -------------------------------------------------------------------------- */
/*                     rebuildCouncilMerkleMap()                              */
/* -------------------------------------------------------------------------- */
describe('CouncilMapContractEventsProvider.rebuildCouncilMerkleMap()', () => {
  it('filters and applies CouncilUpdateActionEvents in blockHeight order', () => {
    const calls: CouncilUpdateOperation[] = [];

    const original = CouncilMap.prototype.applyOperations;
    CouncilMap.prototype.applyOperations = function (...operations: CouncilUpdateOperation[]) {
      calls.push(...operations);
    };

    try {
      CouncilMapContractEventsProvider.rebuildCouncilMerkleMap([
        makeCouncilActionEvent(2, 5), // later
        makeCouncilActionEvent(1, 3), // earlier
        {
          type: 'Other',
          event: { data: {} },
          blockHeight: UInt32.from(0),
        } as any,
      ]);

      // Expect: operations applied in blockHeight order: 1 then 2
      assert.strictEqual(calls.length, 2);
      assert.ok(calls[0].seat.value.equals(Seat.fromIndex(1).value));
      assert.ok(calls[1].seat.value.equals(Seat.fromIndex(2).value));
    } finally {
      CouncilMap.prototype.applyOperations = original;
    }
  });

});

/* -------------------------------------------------------------------------- */
/*                             applyEvents()                                  */
/* -------------------------------------------------------------------------- */

describe('CouncilMapContractEventsProvider.applyEvents()', () => {
  it('ignores non-CouncilUpdateActionEvent events', () => {
    let called = false;
    const stubMap = {
      applyOperations: () => (called = true),
    } as unknown as CouncilMap;

    CouncilMapContractEventsProvider.applyEvents(stubMap, [
      {
        type: 'Irrelevant',
        blockHeight: UInt32.from(0),
        event: { data: {} },
      } as any,
    ]);

    assert.strictEqual(called, false);
  });
});

/* -------------------------------------------------------------------------- */
/*                               fromContract()                               */
/* -------------------------------------------------------------------------- */

describe('CouncilMapContractEventsProvider.fromContract()', () => {
  it('initializes correctly from contract', async () => {
    const root = createFakeRoot();
    const contract = {
      fetchEvents: async () => [],
      councilMerkleMapRoot: { fetch: async () => root },
    } as unknown as ZkusdGoverningCouncilContract;

    const provider = CouncilMapContractEventsProvider.fromContract(
      contract,
      async () => UInt32.from(0)
    );
    (provider as any).councilMap = { root };

    assert.ok(await provider.matchesOnchainRoot());
  });
});
