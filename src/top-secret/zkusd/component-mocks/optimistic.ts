// import {
//   IntentCommitment,
//   BlockEndSignal,
//   OptimisticState,
//   StateProcessorLog,
// } from './optimistic-types.js';

// import { IntentProof, IntentProofKind } from './types/intent-proof.js';
// import * as Rollup from './programs/rollup.js'dds; // alias for brevity

// import { ZkUsdState } from './data/state.js';
// import { VaultMap } from './data/maps/vault-map.js';
// import { ZkUsdMap } from './data/maps/zkusd-map.js';
// import { RollupDataProvider } from './rollup-data-provider.js';
// import { StateEventQueue } from './rollup-state-event-queue.js';
// import { StatePublisher } from './rollup-state-publisher.js';

// /* ------------------------------------------------------------------ */
// /*  shared service interfaces                                          */
// /* ------------------------------------------------------------------ */

// export type CommitmentProcessingResult = { success: boolean; reason?: string };

// export interface ZkusdStateManager {
//   getState(): Promise<ZkUsdState>;
//   setState(state: ZkUsdState): Promise<void>;
//   finishIntentBlock(): Promise<void>;
// }

// /* ------------------------------------------------------------------ */
// /*  in-memory state manager                                            */
// /* ------------------------------------------------------------------ */

// export class InMemoryZkusdStateManager implements ZkusdStateManager {
//   constructor(private state: ZkUsdState) {}
//   async getState() {
//     return this.state;
//   }
//   async setState(s: ZkUsdState) {
//     this.state = s;
//   }
//   async finishIntentBlock() {
//     this.state.intentVaultMapRoot = this.state.liveVaultMapRoot;
//     this.state.intentZkUsdMapRoot = this.state.liveZkUsdMapRoot;
//   }
// }

// /* ------------------------------------------------------------------ */
// /*  state event processor                                             */
// /* ------------------------------------------------------------------ */

// export interface StateEventProcessor {
//   resetState(args: { zkusdState: ZkUsdState }): Promise<void>;

//   verifyAndApplyIntent(
//     proof: IntentCommitment,
//     opts?: { requeueIfNoProof?: boolean }
//   ): Promise<CommitmentProcessingResult>;

//   processPendingMissing(): Promise<void>;

//   applyBlockEnd(pochEnd: BlockEndSignal): Promise<OptimisticState>;

//   getStateProcessorLog(): Promise<StateProcessorLog>;

//   liveVaultMap(): Promise<VaultMap>;
//   liveZkUsdMap(): Promise<ZkUsdMap>;
//   zkusdState(): Promise<ZkUsdState>;
// }

// /* ------------------------------------------------------------------ */
// /*  optimistic state computer                                         */
// /* ------------------------------------------------------------------ */

// export class OptimisticStateComputer {
//   private running = false;
//   constructor(
//     private queue: StateEventQueue,
//     private processor: StateEventProcessor,
//     private publisher: StatePublisher
//   ) {}

//   async step(n: number = 1): Promise<void> {
//     this.running = true;
//     await this.loop({ steps: n });
//     this.running = false;
//   }

//   async start() {
//     this.running = true;
//     await this.loop();
//   }
//   async stop() {
//     this.running = false;
//   }

//   private _intentVaultMap: VaultMap;
//   private _intentZkUsdMap: ZkUsdMap;

//   public get intentVaultMap(): VaultMap {
//     return this._intentVaultMap;
//   }
//   public get intentZkUsdMap(): ZkUsdMap {
//     return this._intentZkUsdMap;
//   }
//   public get zkusdState(): Promise<ZkUsdState> {
//     return this.processor.zkusdState();
//   }

//   private async loop({ steps }: { steps?: number } = {}): Promise<void> {
//     let i = 0;

//     while (this.running && (steps === undefined || i < steps)) {
//       console.log('Processing event:', i);
//       const evt = await this.queue.awaitNextItem();
//       if (!evt) continue;
//       console.log('Processing event:', evt);

//       try {
//         if (evt.kind === 'intent-proof') {
//           await this.processor.verifyAndApplyIntent(evt, {
//             requeueIfNoProof: true,
//           });
//         } else {
//           // block-end
//           console.log('Applying block end');
//           const state = await this.processor.applyBlockEnd(evt);
//           // clone maps
//           this._intentVaultMap = cloneVaultMap(
//             await this.processor.liveVaultMap()
//           );
//           this._intentZkUsdMap = cloneZkUsdMap(
//             await this.processor.liveZkUsdMap()
//           );
//           await this.publisher.publishComputedState(state);
//         }
//       } catch (err) {
//         console.error('[OptStateComputer] processing error:', err);
//         console.log((await this.processor.getStateProcessorLog()).toString());
//       }
//       i++;
//       console.log(`Processed ${i} events`);
//       // print loop arguments
//       console.log('i', i);
//       console.log('steps', steps);
//       console.log('running', this.running);
//     }
//   }
// }

// export function cloneVaultMap(vaultMap: VaultMap): VaultMap {
//   const clone = new VaultMap();
//   for (const { key, value } of vaultMap.data.get().sortedLeaves) {
//     clone.set(key, value);
//   }
//   return clone;
// }

// export function cloneZkUsdMap(zkUsdMap: ZkUsdMap): ZkUsdMap {
//   const clone = new ZkUsdMap();
//   for (const { key, value } of zkUsdMap.data.get().sortedLeaves) {
//     clone.set(key, value);
//   }
//   return clone;
// }

// /* ------------------------------------------------------------------ */
// /*  state-event processor                                              */
// /* ------------------------------------------------------------------ */

// type ProofHandler<P extends IntentProof> = (proof: P) => Promise<void>;

// export class OptimisticStateProcessor implements StateEventProcessor {
//   private readonly missing: IntentCommitment[] = [];

//   constructor(
//     private readonly log: StateProcessorLog,
//     private readonly data: RollupDataProvider,
//     private readonly localState: ZkusdStateManager,
//     private readonly _liveVaultMap: VaultMap,
//     private readonly _liveZkUsdMap: ZkUsdMap
//   ) {}

//   liveVaultMap(): Promise<VaultMap> {
//     return Promise.resolve(this._liveVaultMap);
//   }
//   liveZkUsdMap(): Promise<ZkUsdMap> {
//     return Promise.resolve(this._liveZkUsdMap);
//   }
//   zkusdState(): Promise<ZkUsdState> {
//     return this.localState.getState();
//   }

//   resetState(args: { zkusdState: ZkUsdState }): Promise<void> {
//     this.log.push(`Resetting state. Sequence: ${args.zkusdState.sequence}`);
//     return this.localState.setState(args.zkusdState);
//   }

//   /* ---------------- generic helper ---------------- */

//   private runProof = async <
//     P extends IntentProof,
//     Fn extends (...a: any[]) => Promise<{ publicOutput: ZkUsdState }>,
//   >(
//     proof: P,
//     rollupFn: Fn,
//     needsZkUsd = false
//   ) => {
//     const prev = await this.localState.getState();
//     try {
//       const { publicOutput } = needsZkUsd
//         ? await rollupFn(
//             prev,
//             proof.proof,
//             this._liveVaultMap,
//             this._liveZkUsdMap
//           )
//         : await rollupFn(prev, proof.proof, this._liveVaultMap);

//       await this.localState.setState(publicOutput);
//     } catch (err) {
//       this.log.push(`Error processing ${proof.kind} proof: ${err}`);
//       throw new Error('Proof verification failed');
//     }
//   };

//   /* ---------------- handler map ------------------- */

//   private readonly handlers: Record<IntentProofKind, ProofHandler<any>> = {
//     transfer: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.transfer, true),
//     mint: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.mintZkUsd, true),
//     burn: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.burnZkUsd, true),
//     redeem: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.redeemCollateral),
//     liquidate: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.liquidate, true),
//     deposit: (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.depositCollateral),
//     'create-vault': (p) =>
//       this.runProof(p, Rollup.ZkUsdRollup.rawMethods.createVault),
//   };

//   /* ---------------- public API -------------------- */

//   async verifyAndApplyIntent(
//     commitment: IntentCommitment,
//     { requeueIfNoProof = true } = {}
//   ): Promise<CommitmentProcessingResult> {
//     console.log('Verifying intent:', commitment);
//     const roots = await this.localState.getState();

//     if (commitment.intentStateRoots.vaultMapRoot) {
//       // check if valid
//       const validVaultMapRoot = commitment.intentStateRoots.vaultMapRoot
//         .equals(roots.intentVaultMapRoot)
//         .toBoolean();
//       if (!validVaultMapRoot) {
//         this.log.push(
//           `Invalid vault map root in commitment ${commitment.commitmentId}`
//         );
//         return { success: false, reason: 'invalid vault map root' };
//       }
//     }
//     if (commitment.intentStateRoots.zkUsdMapRoot) {
//       // check if valid
//       const validZkUsdMapRoot = commitment.intentStateRoots.zkUsdMapRoot
//         .equals(roots.intentZkUsdMapRoot)
//         .toBoolean();
//       if (!validZkUsdMapRoot) {
//         this.log.push(
//           `Invalid zkUSD map root in commitment ${commitment.commitmentId}`
//         );
//         return { success: false, reason: 'invalid zkUSD map root' };
//       }
//     }

//     const proof = await this.data.getIntentProof(commitment);
//     if (!proof) {
//       this.log.push(`Proof missing for commitment ${commitment.commitmentId}`);
//       if (requeueIfNoProof) this.missing.push(commitment);
//       return { success: false, reason: 'proof missing' };
//     }

//     await this.handlers[proof.kind](proof);
//     console.log('Intent processed successfully');
//     return { success: true };
//   }

//   async processPendingMissing() {
//     const items = [...this.missing];
//     this.missing.length = 0;
//     for (const c of items)
//       await this.verifyAndApplyIntent(c, { requeueIfNoProof: false });
//   }

//   async applyBlockEnd(_: BlockEndSignal): Promise<OptimisticState> {
//     console.log('Applying block end');
//     await this.localState.finishIntentBlock();
//     return { intentBlockState: await this.localState.getState() };
//   }

//   async getStateProcessorLog() {
//     return this.log;
//   }
// }
