import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionTreeContractEventsProvider } from './event-based-resolution-tree-provider.js';
import { ResolutionTree } from './resolution-tree.js';
import { Field } from 'o1js';
import { UInt32 } from 'o1js';
import { ZkusdGoverningCouncilContract } from '../../../contracts/zkusd-governing-council.js';
import { EngineUpdateProposalPassedEvent } from '../events.js';

/* -------------------------------------------------------------------------- */
/*                              Helper Stubs                                  */
/* -------------------------------------------------------------------------- */

function createFakeRoot(): Field {
  const fake = {
    equals: (other: any) => ({ toBoolean: () => other === fake }),
  };
  return fake as unknown as Field;
}
function makePPEvent(index: bigint, hash: Field, height: number = 0) {
  const data = new EngineUpdateProposalPassedEvent({
    resolutionTreeRootBefore: Field(0),
    updateHash: Field(hash),
    resolutionIndex: UInt32.from(index),
  });

  return {
    type: 'ProposalPassed',
    blockHeight: UInt32.from(height),
    event: { data },
  };
}

/* -------------------------------------------------------------------------- */
/*                                #get() suite                                */
/* -------------------------------------------------------------------------- */

describe('ResolutionTreeContractEventsProvider#get()', () => {
  it('returns the cached tree when it is already synchronised with the on-chain root', async () => {
    const root = createFakeRoot();
    const treeStub: any = { getRoot: () => root };

    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root
    );

    (provider as any).tree = treeStub;

    let refreshCalls = 0;
    (provider as any).refresh = async () => {
      refreshCalls += 1;
    };

    const result = await provider.get();
    assert.strictEqual(result, treeStub);
    assert.strictEqual(refreshCalls, 0);
  });

  it('refreshes the tree (first build) when the cache is empty', async () => {
    const root = createFakeRoot();
    const treeStub: any = { getRoot: () => root };

    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root
    );

    let refreshCalls = 0;
    (provider as any).refresh = async () => {
      (provider as any).tree = treeStub;
      refreshCalls += 1;
    };

    const result = await provider.get();
    assert.strictEqual(result, treeStub);
    assert.strictEqual(refreshCalls, 1);
  });

  it('refreshes when the cached root is stale and succeeds after one refresh', async () => {
    const oldRoot = createFakeRoot();
    const newRoot = createFakeRoot();

    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => newRoot
    );

    (provider as any).tree = { getRoot: () => oldRoot };

    (provider as any).refresh = async () => {
      (provider as any).tree = { getRoot: () => newRoot };
    };

    const result = await provider.get();
    assert.deepStrictEqual(result.getRoot(), newRoot);
  });

  it('throws when the tree remains stale even after a refresh attempt', async () => {
    const stale1 = createFakeRoot();
    const stale2 = createFakeRoot();
    const onChain = createFakeRoot();

    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => onChain
    );

    (provider as any).tree = { getRoot: () => stale1 };
    (provider as any).refresh = async () => {
      (provider as any).tree = { getRoot: () => stale2 };
    };

    await assert.rejects(
      provider.get(),
      /does not match the onchain state even after refreshing/
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                           #matchesOnchainRoot()                             */
/* -------------------------------------------------------------------------- */

describe('ResolutionTreeContractEventsProvider#matchesOnchainRoot()', () => {
  it('throws when called before any tree exists', async () => {
    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => createFakeRoot()
    );
    await assert.rejects(provider.matchesOnchainRoot(), /no root available/);
  });

  it('throws when fetchOnchainRoot() returns null', async () => {
    const root = createFakeRoot();
    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => null as any
    );
    (provider as any).tree = { getRoot: () => root };
    await assert.rejects(
      provider.matchesOnchainRoot(),
      /Cannot fetch resolution tree root from the chain/
    );
  });

  it('returns true on identical roots', async () => {
    const root = createFakeRoot();
    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root
    );
    (provider as any).tree = { getRoot: () => root };
    assert.strictEqual(await provider.matchesOnchainRoot(), true);
  });

  it('returns false when roots differ', async () => {
    const cached = createFakeRoot();
    const onChain = createFakeRoot();
    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => onChain
    );
    (provider as any).tree = { getRoot: () => cached };
    assert.strictEqual(await provider.matchesOnchainRoot(), false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                #refresh()                                   */
/* -------------------------------------------------------------------------- */

describe('ResolutionTreeContractEventsProvider#refresh()', () => {
  it('fetches events and rebuilds the tree', async () => {
    const events = [makePPEvent(1n, Field.from(123))];

    const provider = new ResolutionTreeContractEventsProvider(
      { fetchEvents: async () => events } as any,
      async () => createFakeRoot()
    );

    let rebuildCalled = false;
    const original = ResolutionTreeContractEventsProvider.rebuildResolutionTree;
    (ResolutionTreeContractEventsProvider as any).rebuildResolutionTree = (
      ev: any
    ) => {
      rebuildCalled = true;
      assert.strictEqual(ev, events);
      return { getRoot: () => createFakeRoot() } as any;
    };

    try {
      await provider.refresh();
      assert.ok(rebuildCalled);
    } finally {
      (ResolutionTreeContractEventsProvider as any).rebuildResolutionTree =
        original;
    }
  });

  it('propagates fetchEvents() errors', async () => {
    const provider = new ResolutionTreeContractEventsProvider(
      {
        fetchEvents: async () => {
          throw new Error('boom');
        },
      } as any,
      async () => createFakeRoot()
    );
    await assert.rejects(provider.refresh(), /boom/);
  });
});

/* -------------------------------------------------------------------------- */
/*                    static rebuildResolutionTree()                           */
/* -------------------------------------------------------------------------- */
describe('ResolutionTreeContractEventsProvider.rebuildResolutionTree()', () => {
  it('populates a new ResolutionTree with ProposalPassed events ordered by blockHeight', () => {
    const tree = ResolutionTreeContractEventsProvider.rebuildResolutionTree([
      makePPEvent(1n, Field.from(1), 2), // later blockHeight
      makePPEvent(1n, Field.from(3), 5), // later blockHeight
      makePPEvent(2n, Field.from(2), 3), // earlier blockHeight
      {
        type: 'Other',
        event: { data: {} },
        blockHeight: UInt32.from(0),
      } as any,
    ]);

    const root = tree.getRoot();

    // expeted tree
    const expected = new ResolutionTree();
    expected.setLeaf(1n, Field.from(3));
    expected.setLeaf(2n, Field.from(2));

    const expectedRoot = expected.getRoot();

    assert.strictEqual(
      root.equals(expectedRoot).toBoolean(),
      true,
      'Should match the expected root'
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                           static applyEvents()                              */
/* -------------------------------------------------------------------------- */
describe('ResolutionTreeContractEventsProvider.applyEvents()', () => {
  it('ignores non-ProposalPassed events', () => {
    let called = false;
    const events = [
      {
        // any type other than 'ProposalPassed'
        type: 'OtherEvent',
        blockHeight: UInt32.from(0),
        event: { data: {} },
      } as any,
    ];

    const stubMap = {
      applyOperations: () => {
        called = true;
      },
    } as any;

    ResolutionTreeContractEventsProvider.applyEvents(stubMap, events as any);

    assert.strictEqual(called, false);
  });
});

/* -------------------------------------------------------------------------- */
/*                         static fromContract()                               */
/* -------------------------------------------------------------------------- */

describe('ResolutionTreeContractEventsProvider.fromContract()', () => {
  it('wires a contract instance correctly', async () => {
    const fakeRoot = createFakeRoot();

    const contractStub = {
      fetchEvents: async () => [],
      resolutionsMerkleRoot: { fetch: async () => fakeRoot },
    } as unknown as ZkusdGoverningCouncilContract;

    const provider =
      ResolutionTreeContractEventsProvider.fromContract(contractStub);

    // pre-seed cache so matchesOnchainRoot() can succeed
    (provider as any).tree = { getRoot: () => fakeRoot };

    assert.strictEqual((provider as any).source, contractStub);
    assert.strictEqual(await provider.matchesOnchainRoot(), true);
  });
});
