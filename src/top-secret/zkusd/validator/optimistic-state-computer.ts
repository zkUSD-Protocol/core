// import { FullState } from './block-state.js';
// import { IntentProof } from '../types/intent-proof.js';
// import { IntentMapOperation } from './map-operation.js';
// import { NextBlockStateCandidate } from './block-state.js';

// export interface OptimisticStateComputer {
//   setState(state: FullState): Promise<void>;
//   getState(): Promise<{
//     previousBlockState: FullState;
//     nextStateCandidate: FullState;
//     newBlockOperations: IntentMapOperation[];
//   }>;
//   getStateCandidate(): Promise<NextBlockStateCandidate>;
//   step(intentProof: IntentProof): Promise<void>;
// }

// export class NonProvingStateComputer implements OptimisticStateComputer {
//   private _liveState: FullState;
//   private _blockState: FullState;
//   private _newBlockOperations: IntentMapOperation[];

//   constructor() {}

//   async setState(state: FullState): Promise<void> {
//     this._liveState = state;
//     this._blockState = state;
//     this._newBlockOperations = [];
//   }
//   async getState(): Promise<{
//     previousBlockState: FullState;
//     nextStateCandidate: FullState;
//     newBlockOperations: IntentMapOperation[];
//   }> {
//     return {
//       previousBlockState: this._blockState,
//       nextStateCandidate: this._liveState,
//       newBlockOperations: this._newBlockOperations,
//     };
//   }
//   async getStateCandidate(): Promise<NextBlockStateCandidate> {
//     return new NextBlockStateCandidate(
//       this._liveState.toCommitment(),
//       this._newBlockOperations,
//       this._liveState.systemParams,
//       Date.now()
//     );
//   }
//   async step(intentProof: IntentProof): Promise<void> {
//     throw new Error('Not implemented');
//   }
// }
