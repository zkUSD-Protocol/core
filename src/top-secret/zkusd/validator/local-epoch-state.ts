import { StateRoots, FullState } from './epoch-state.js';
import { IntentMapOperation } from './map-operation.js';

export interface FinalizedState {
  setState(state: FullState): Promise<void>;

  getState(): Promise<FullState>;

  checkStoredRoots(StateRoots: StateRoots): Promise<boolean>;

  updateEpochState(
    finalizedEpochOperations: IntentMapOperation[]
  ): Promise<void>;

  rootsEqual(StateRoots: StateRoots): Promise<boolean>;
}

export class InMemoryFinalizedEpochState implements FinalizedState {
  private _state: FullState;
  private _epochStateRoot: StateRoots;

  constructor(initialState: FullState) {
    this._state = initialState;
    this._epochStateRoot = initialState.roots();
  }

  async checkStoredRoots(StateRoots: StateRoots): Promise<boolean> {
    return (
      this._epochStateRoot.vaultMapRoot
        .equals(StateRoots.vaultMapRoot)
        .toBoolean() &&
      this._epochStateRoot.zkUsdMapRoot
        .equals(StateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }

  async setState(state: FullState): Promise<void> {
    this._state = state;
    this._epochStateRoot = state.roots();
  }

  async getState(): Promise<FullState> {
    return this._state;
  }

  async updateEpochState(
    finalizedEpochOperations: IntentMapOperation[]
  ): Promise<void> {
    this._state.applyMapOperations(...finalizedEpochOperations);
    this._epochStateRoot = this._state.roots();
  }

  async rootsEqual(StateRoots: StateRoots): Promise<boolean> {
    return (
      this._epochStateRoot.vaultMapRoot
        .equals(StateRoots.vaultMapRoot)
        .toBoolean() &&
      this._epochStateRoot.zkUsdMapRoot
        .equals(StateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }
}
