// proposal-map-contract-provider.test.ts
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { UInt32, Field, PublicKey } from 'o1js';
import { ContractEvent, HasFetchEvents } from '../../../../system/council/common';
import { CouncilTree } from '../../../../system/council/council-tree.js';
import { CouncilTreeContractProvider } from '../../../../system/council/event-based-council-tree-provider';

/* -------------------------------------------------------------------------- */
/*                                 Helpers                                    */
/* -------------------------------------------------------------------------- */

const mkFakePublicKey = (): PublicKey =>
  PublicKey.fromBase58('B62qqqG7uPDRbDbGbnUwBXLUewbyZm6PbRW1uBDTf7pDQgdAoqDx4fN');

const u32 = (n: number | bigint): UInt32 => UInt32.from(BigInt(n));

const mkCouncilEvent = (
  height: number,
  members: PublicKey[]
): ContractEvent<'NewCouncilInitializedWithFixedKeys'> => {
  const councilTree = new CouncilTree(members);
  const root = councilTree.getRoot();

  return {
    type: 'NewCouncilInitializedWithFixedKeys',
    event: {
      data: {
        councilMerkleRoot: root,
        councilMembers: {
          councilMembers: members,
        },
      },
    },
    blockHeight: u32(height),
  };
};

class MockEventSource implements HasFetchEvents {
  constructor(
    private readonly batches: Array<Awaited<ReturnType<HasFetchEvents['fetchEvents']>>>
  ) {}

  async fetchEvents(): ReturnType<HasFetchEvents['fetchEvents']> {
    return this.batches.shift() ?? [];
  }
}

const undefinedBlockchainLength = async (): Promise<UInt32 | undefined> => {
  return undefined;
}

const definedBlockchainLength = async (): Promise<UInt32 | undefined> => {
  return UInt32.from(200);
}

/* -------------------------------------------------------------------------- */
/*                                 Tests                                      */
/* -------------------------------------------------------------------------- */

describe('CouncilTreeContractProvider', () => {
  let members: PublicKey[];
  let goodEvent: ContractEvent<'NewCouncilInitializedWithFixedKeys'>;
  let expectedRoot: Field;

  beforeEach(() => {
    members = [mkFakePublicKey(), mkFakePublicKey(), mkFakePublicKey()];
    goodEvent = mkCouncilEvent(100, members);
    expectedRoot = goodEvent.event.data.councilMerkleRoot;
  });

  test('builds the tree and returns it when roots match', async () => {
    const source: HasFetchEvents = new MockEventSource([[goodEvent]]);
    const fetchRoot: () => Promise<Field | undefined> = async () => expectedRoot;

    const provider = new CouncilTreeContractProvider(source, fetchRoot, undefinedBlockchainLength);
    const tree = await provider.get();

    assert.deepEqual(tree.getRoot(), expectedRoot);
  });

  test('throws if fetchOnchainRoot returns undefined', async () => {
    const source: HasFetchEvents = new MockEventSource([[goodEvent]]);
    const fetchRoot: () => Promise<undefined> = async () => undefined;

    const provider = new CouncilTreeContractProvider(source, fetchRoot, undefinedBlockchainLength);

    await assert.rejects(() => provider.get(), /Cannot fetch on-chain root/i);
  });

  test('throws when the on-chain root differs from the event root', async () => {
    const source: HasFetchEvents = new MockEventSource([[goodEvent]]);
    const badRoot = new CouncilTree([mkFakePublicKey()]).getRoot();
    const fetchRoot: () => Promise<Field | undefined> = async () => badRoot;

    const provider = new CouncilTreeContractProvider(source, fetchRoot, undefinedBlockchainLength);

    await assert.rejects(() => provider.get(), /does not match the event data/i);
  });

  test('scans older chunks until the NewCouncil event is found', async () => {
    const fillerEvent = {
      type: 'IrrelevantEvent',
      event: { data: {} },
      blockHeight: u32(150),
    };

    const source: HasFetchEvents = new MockEventSource([
      [fillerEvent],
      [goodEvent],
    ]);

    const fetchRoot: () => Promise<Field | undefined> = async () => expectedRoot;

    const provider = new CouncilTreeContractProvider(source, fetchRoot, definedBlockchainLength);
    const tree = await provider.get();

    assert.deepEqual(tree.getRoot(), expectedRoot);
  });

  test('throws if no NewCouncilInitializedWithFixedKeys event exists', async () => {
    const source: HasFetchEvents = new MockEventSource([
      [{ type: 'OtherEvent', event: { data: {} }, blockHeight: u32(10) }],
      [],
    ]);

    const fetchRoot: () => Promise<Field | undefined> = async () =>
      new CouncilTree([mkFakePublicKey()]).getRoot();

    const provider = new CouncilTreeContractProvider(source, fetchRoot, definedBlockchainLength);

    await assert.rejects(
      () => provider.build(),
      /No NewCouncilInitializedWithFixedKeys event found/i
    );
  });
  test('returns cached tree without rebuilding', async () => {
    const source = new MockEventSource([[goodEvent]]);
    const fetchRoot = async (): Promise<Field | undefined> => expectedRoot;

    const provider = new CouncilTreeContractProvider(source, fetchRoot, definedBlockchainLength);
    const first = await provider.get();  // triggers build()

    const second = await provider.get(); // should use cached tree
    assert.strictEqual(first, second);
  });

});
