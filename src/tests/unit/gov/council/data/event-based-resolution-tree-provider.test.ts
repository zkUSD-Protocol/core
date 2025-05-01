// // test/resolution-tree-provider.test.ts
// import test from 'node:test';
// import assert from 'node:assert/strict';
// import { UInt32, Field } from 'o1js';
// import { CouncilProposalPassedEvent } from './events.js';
// import { ResolutionTreeContractProvider } from './event-based-resolution-tree-provider.js';
// import { HasFetchEvents } from './common.js';

// // Mock event generator
// function createPassedEvent(index: number, rootBefore: Field, updateHash: Field, blockHeight: number) {
//   return {
//     type: 'ProposalPassed',
//     event: {
//       data: new CouncilProposalPassedEvent({
//         resolutionTreeRootBefore: rootBefore,
//         resolutionIndex: UInt32.from(index),
//         updateHash,
//       }),
//     },
//     blockHeight: UInt32.from(blockHeight),
//   };
// }

// // Mock source factory
// function createMockEventSource(eventChunks: any[][]): HasFetchEvents {
//   let callCount = 0;
//   return {
//     fetchEvents: async (_start?: UInt32, _end?: UInt32) => {
//       return eventChunks[callCount++] ?? [];
//     },
//   };
// }

// test('lazy get() triggers refresh', async () => {
//   const mockEvent = createPassedEvent(0, Field(0), Field(42), 100);
//   const source = createMockEventSource([[mockEvent]]);
//   const provider = new ResolutionTreeContractProvider(source, 1000);

//   const tree = await provider.get();
//   const leaf = tree.getLeaf(0n);

//   assert.equal(leaf.equals(Field(42)).toBoolean(), true);
// });

// test('refresh() with no events returns an empty tree', async () => {
//   const source = createMockEventSource([[]]);
//   const provider = new ResolutionTreeContractProvider(source, 1000);

//   await provider.refresh();
//   const tree = await provider.get();

//   // All leaves should be zero
//   for (let i = 0n; i < tree.leafCount; i++) {
//     assert.equal(tree.getLeaf(i).toBigInt(), 0n);
//   }
// });

// test('refresh() builds tree from genesis (rootBefore = 0)', async () => {
//   const events = [
//     createPassedEvent(0, Field(0), Field(100), 100),
//     createPassedEvent(1, Field(0), Field(200), 99),
//   ];
//   const source = createMockEventSource([events]);
//   const provider = new ResolutionTreeContractProvider(source, 1000);

//   await provider.refresh();
//   const tree = await provider.get();

//   assert.equal(tree.getLeaf(0n).toBigInt(), Field(100).toBigInt());
//   assert.equal(tree.getLeaf(1n).toBigInt(), Field(200).toBigInt());
// });
