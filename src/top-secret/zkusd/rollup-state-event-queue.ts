// import { SystemStateEvent } from "./optimistic-types.js";
// import { IntentProof, extractIntentStateCommitment, hashAnyIntentProof } from "./types/intent-proof.js";
// import { IntentCommitment, IntentStateRoots } from "./optimistic-types.js";

// export interface StateEventQueue {
//   awaitNextItem(): Promise<SystemStateEvent | null>;
//   itemsAwaiting(): number;
// }

// // generate events manually, then gets stored in the queue
// // use a structure with FIFO interface
// export class MockStateEventQueue implements StateEventQueue {
//   private queue: SystemStateEvent[] = [];

//   private idCounter = 0;
//   private blockNumber =0;

//   constructor() {}
//   itemsAwaiting(): number {
//     return this.queue.length;
//   }

//   awaitNextItem(): Promise<SystemStateEvent | null> {
//     return new Promise(resolve => {
//       if (this.queue.length > 0) {
//         resolve(this.queue.shift()!);
//       } else {
//         resolve(null);
//       }
//     });
//   }

//   pushIntentCommitment(commitment: IntentCommitment): void {
//     this.queue.push(commitment);
//   }

//   pushIntentViaProof(proof: IntentProof): void {
//     // prepare intentstate roots
//     let intentStateRoots: IntentStateRoots;
//     intentStateRoots = extractIntentStateCommitment(proof);

//     this.queue.push({
//       kind: 'intent-proof',
//       intentStateRoots,
//       proofHash: hashAnyIntentProof(proof),
//       commitmentId: this.idCounter.toString()
//     });
//     this.idCounter++;
//   }

//   pushBlockEnd(): void {
//     this.queue.push({
//       kind: 'block-end',
//       blockNumber: this.blockNumber
//     });
//     this.blockNumber++;
//   }

// }
