import { EpochStateRoots, FullEpochState } from './epoch-state.js';
import { IntentMapOperation } from './map-operation.js';

export interface FinalizedEpochState {
  setState(state: FullEpochState): Promise<void>;

  getState(): Promise<FullEpochState>;

  checkStoredRoots(epochStateRoots: EpochStateRoots): Promise<boolean>;

  updateEpochState(
    finalizedEpochOperations: IntentMapOperation[]
  ): Promise<void>;

  rootsEqual(epochStateRoots: EpochStateRoots): Promise<boolean>;
}

export class InMemoryFinalizedEpochState implements FinalizedEpochState {
  private _state: FullEpochState;
  private _epochStateRoot: EpochStateRoots;

  constructor(initialState: FullEpochState) {
    this._state = initialState;
    this._epochStateRoot = initialState.roots();
  }

  async checkStoredRoots(epochStateRoots: EpochStateRoots): Promise<boolean> {
    return (
      this._epochStateRoot.vaultMapRoot
        .equals(epochStateRoots.vaultMapRoot)
        .toBoolean() &&
      this._epochStateRoot.zkUsdMapRoot
        .equals(epochStateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }

  async setState(state: FullEpochState): Promise<void> {
    this._state = state;
    this._epochStateRoot = state.roots();
  }

  async getState(): Promise<FullEpochState> {
    return this._state;
  }

  async updateEpochState(
    finalizedEpochOperations: IntentMapOperation[]
  ): Promise<void> {
    this._state.applyMapOperations(...finalizedEpochOperations);
    this._epochStateRoot = this._state.roots();
  }

  async rootsEqual(epochStateRoots: EpochStateRoots): Promise<boolean> {
    return (
      this._epochStateRoot.vaultMapRoot
        .equals(epochStateRoots.vaultMapRoot)
        .toBoolean() &&
      this._epochStateRoot.zkUsdMapRoot
        .equals(epochStateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }
}
