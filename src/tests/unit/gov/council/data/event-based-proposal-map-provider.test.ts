import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ProposalMap } from '../../../../../system/council/data/proposal-merkle-map.js';

import { Field, UInt32 } from 'o1js';
import { ZkusdGoverningCouncilContract } from '../../../../../contracts/zkusd-governing-council.js';
import { EngineUpdateProposalVoteEvent } from '../../../../../system/council/events.js';
import { ProposalMapContractEventsProvider } from '../../../../../system/council/data/event-based-proposal-map-provider.js';

/* -------------------------------------------------------------------------- */
/*                              Helper Stubs                                  */
/* -------------------------------------------------------------------------- */

function createFakeRoot(): Field {
  const fake = {
    equals: (other: any) => ({ toBoolean: () => other === fake }),
  };
  return fake as unknown as Field;
}

function makePS(
  idx: bigint,
  hash = Field(idx),
  bitArray = Field(idx * 2n),
  height = 0
) {
  const data = new EngineUpdateProposalVoteEvent({
    proposalMapRootBefore: Field(0),
    updateHash: hash,
    acceptedVoteBitArray: bitArray,
    resolutionIndex: UInt32.from(idx),
  });

  return {
    type: 'ProposalSupported',
    blockHeight: UInt32.from(height),
    event: { data },
  };
}

/* -------------------------------------------------------------------------- */
/*                                   #get()                                   */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider#get()', () => {
  it('returns cached map when up-to-date', async () => {
    const root = createFakeRoot();
    const mapStub: any = { getRoot: () => root };

    const provider = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => undefined
    );

    (provider as any).proposalMap = mapStub;

    let refreshCount = 0;
    (provider as any).refresh = async () => (refreshCount += 1);

    const res = await provider.get();
    assert.strictEqual(res, mapStub);
    assert.strictEqual(refreshCount, 0);
  });

  it('refreshes when first built', async () => {
    const root = createFakeRoot();
    const mapStub: any = { getRoot: () => root };

    const provider = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => undefined
    );

    (provider as any).refresh = async () => {
      (provider as any).proposalMap = mapStub;
    };

    const res = await provider.get();
    assert.strictEqual(res, mapStub);
  });

  it('refreshes stale cache and succeeds', async () => {
    const oldRoot = createFakeRoot();
    const newRoot = createFakeRoot();

    const provider = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => newRoot,
      async () => undefined
    );

    (provider as any).proposalMap = { getRoot: () => oldRoot };
    (provider as any).refresh = async () => {
      (provider as any).proposalMap = { getRoot: () => newRoot };
    };

    const map = await provider.get();
    assert.strictEqual(map.getRoot(), newRoot);
  });

  it('throws if cache still mismatches after refresh', async () => {
    const old1 = createFakeRoot();
    const old2 = createFakeRoot();
    const chainRoot = createFakeRoot();

    const provider = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => chainRoot,
      async () => undefined
    );

    (provider as any).proposalMap = { getRoot: () => old1 };
    (provider as any).refresh = async () => {
      (provider as any).proposalMap = { getRoot: () => old2 };
    };

    await assert.rejects(provider.get(), /does not match the onchain state/i);
  });
});

/* -------------------------------------------------------------------------- */
/*                           #matchesOnchainRoot()                            */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider#matchesOnchainRoot()', () => {
  it('throws if no map yet', async () => {
    const p = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => createFakeRoot(),
      async () => undefined
    );
    await assert.rejects(p.matchesOnchainRoot(), /no root available/i);
  });

  it('throws if on-chain root unavailable', async () => {
    const cached = createFakeRoot();
    const p = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => null as any,
      async () => undefined
    );
    (p as any).proposalMap = { getRoot: () => cached };
    await assert.rejects(
      p.matchesOnchainRoot(),
      /cannot fetch proposal map root/i
    );
  });

  it('returns true when roots match', async () => {
    const root = createFakeRoot();
    const p = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => root,
      async () => undefined
    );
    (p as any).proposalMap = { getRoot: () => root };
    assert.ok(await p.matchesOnchainRoot());
  });

  it('returns false when roots differ', async () => {
    const p = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => [] } as any,
      async () => createFakeRoot(),
      async () => undefined
    );
    (p as any).proposalMap = { getRoot: () => createFakeRoot() };
    assert.strictEqual(await p.matchesOnchainRoot(), false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  #refresh()                                */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider#refresh()', () => {
  it('fetches events and rebuilds map', async () => {
    const evts = [makePS(1n)];
    const p = new ProposalMapContractEventsProvider(
      { fetchEvents: async () => evts } as any,
      async () => createFakeRoot(),
      async () => undefined
    );

    let called = false;
    const original = ProposalMapContractEventsProvider.rebuildProposalMap;
    (ProposalMapContractEventsProvider as any).rebuildProposalMap = (
      e: any
    ) => {
      called = true;
      assert.strictEqual(e, evts);
      return { getRoot: () => createFakeRoot() } as any;
    };

    try {
      await p.refresh();
      assert.ok(called);
    } finally {
      (ProposalMapContractEventsProvider as any).rebuildProposalMap = original;
    }
  });

  it('propagates fetchEvents errors', async () => {
    const p = new ProposalMapContractEventsProvider(
      {
        fetchEvents: async () => {
          throw new Error('boom');
        },
      } as any,
      async () => createFakeRoot(),
      async () => undefined
    );
    await assert.rejects(p.refresh(), /boom/);
  });
});

/* -------------------------------------------------------------------------- */
/*                         rebuildProposalMap()                               */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider.rebuildProposalMap()', () => {
  it('replays ProposalSupported events ordered by blockHeight', () => {
    const calls: Array<[Field, Field]> = [];

    const original = ProposalMap.prototype.set;
    ProposalMap.prototype.set = function (hash: Field, bits: Field) {
      calls.push([hash, bits]);
    };

    try {
      ProposalMapContractEventsProvider.rebuildProposalMap([
        makePS(1n, Field(1), Field(11), 5), // later block
        makePS(2n, Field(2), Field(22), 3), // earlier block
        {
          type: 'Other',
          event: { data: {} },
          blockHeight: UInt32.from(0),
        } as any,
      ]);

      assert.deepStrictEqual(calls, [
        [Field(2), Field(22)],
        [Field(1), Field(11)],
      ]);
    } finally {
      ProposalMap.prototype.set = original;
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                             applyEvents()                                  */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider.applyEvents()', () => {
  it('ignores events of other types', () => {
    let called = false;
    const mapStub = { set: () => (called = true) } as any;

    ProposalMapContractEventsProvider.applyEvents(mapStub, [
      {
        type: 'Irrelevant',
        event: { data: {} },
        blockHeight: UInt32.from(0),
      } as any,
    ]);

    assert.strictEqual(called, false);
  });
});

/* -------------------------------------------------------------------------- */
/*                               fromContract()                               */
/* -------------------------------------------------------------------------- */

describe('ProposalMapContractEventsProvider.fromContract()', () => {
  it('creates provider wired to contract', async () => {
    const root = createFakeRoot();
    const contract = {
      fetchEvents: async () => [],
      proposalsMerkleMapRoot: { fetch: async () => root },
    } as unknown as ZkusdGoverningCouncilContract;

    const p = ProposalMapContractEventsProvider.fromContract(
      contract,
      async () => undefined
    );

    (p as any).proposalMap = { getRoot: () => root };

    assert.strictEqual((p as any).source, contract);
    assert.ok(await p.matchesOnchainRoot());
  });
});
