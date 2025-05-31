import { FullState, StateRoots } from './block-state.js';
import { IntentProof } from '../types/intent-proof.js';
import { IntentMapOperation } from './map-operation.js';
import { NextStateCandidate } from './block-state.js';

export interface OptimisticStateComputer {
  getFinalizedStateRoots(): StateRoots;
  setState(state: FullState): Promise<void>;
  getState(): Promise<{
    previousBlockState: FullState;
    nextStateCandidate: FullState;
    newBlockOperations: IntentMapOperation[];
  }>;
  getStateCandidate(): Promise<NextStateCandidate>;
  step(intentProof: IntentProof): Promise<void>;
}

export class NonProvingStateComputer implements OptimisticStateComputer {
  private _liveState: FullState;
  private _blockState: FullState;
  private _newBlockOperations: IntentMapOperation[];

  constructor() {}
    getFinalizedStateRoots(): StateRoots {
        return this._blockState.roots();
    }

  async setState(state: FullState): Promise<void> {
    this._liveState = state;
    this._blockState = state;
    this._newBlockOperations = [];
  }
  async getState(): Promise<{
    previousBlockState: FullState;
    nextStateCandidate: FullState;
    newBlockOperations: IntentMapOperation[];
  }> {
    return {
      previousBlockState: this._blockState,
      nextStateCandidate: this._liveState,
      newBlockOperations: this._newBlockOperations,
    };
  }
  async getStateCandidate(): Promise<NextStateCandidate> {
    return new NextStateCandidate(
      this._liveState.roots(),
      this._newBlockOperations,
    );
  }
  async step(intentProof: IntentProof): Promise<void> {
    throw new Error('Not implemented');
  }
}
