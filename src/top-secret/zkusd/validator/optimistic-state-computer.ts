import { FullState } from './epoch-state.js';
import { IntentProof } from '../types/intent-proof.js';
import { IntentMapOperation } from './map-operation.js';
import { NextEpochStateCandidate } from './epoch-state.js';

export interface OptimisticStateComputer {
  setState(state: FullState): Promise<void>;
  getState(): Promise<{
    previousEpochState: FullState;
    nextEpochState: FullState;
    newEpochOperations: IntentMapOperation[];
  }>;
  getIncrementalState(): Promise<NextEpochStateCandidate>;
  step(intentProof: IntentProof): Promise<void>;
}

export class NonProvingStateComputer implements OptimisticStateComputer {
  private _liveState: FullState;
  private _epochState: FullState;
  private _newEpochOperations: IntentMapOperation[];

  constructor() {}

  async setState(state: FullState): Promise<void> {
    this._liveState = state;
    this._epochState = state;
    this._newEpochOperations = [];
  }
  async getState(): Promise<{
    previousEpochState: FullState;
    nextEpochState: FullState;
    newEpochOperations: IntentMapOperation[];
  }> {
    return {
      previousEpochState: this._epochState,
      nextEpochState: this._liveState,
      newEpochOperations: this._newEpochOperations,
    };
  }
  async getIncrementalState(): Promise<NextEpochStateCandidate> {
    return new NextEpochStateCandidate(
      this._liveState.toCommitment(),
      this._newEpochOperations,
      this._liveState.systemParams,
      Date.now()
    );
  }
  async step(intentProof: IntentProof): Promise<void> {
    throw new Error('Not implemented');
  }
}
