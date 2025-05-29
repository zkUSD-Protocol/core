import { StateRoots, FullState } from './epoch-state.js';
import { IntentMapOperation } from './map-operation.js';

export interface LocalStateProxy {
  
  setState(state: FullState): Promise<void>;

  useState(): Promise<FullState>;
  
  stateRoots(): Promise<StateRoots>;

  checkStoredRoots(StateRoots: StateRoots): Promise<boolean>;

  applyIntentOperations(
    finalizedEpochOperations: IntentMapOperation[]
  ): Promise<void>;

  rootsEqual(StateRoots: StateRoots): Promise<boolean>;
}

export class InMemoryStateProxy implements LocalStateProxy {
  private _state: FullState;
  private _epochStateRoot: StateRoots;

  constructor(initialState: FullState) {
    this._state = initialState;
    this._epochStateRoot = initialState.roots();
  }

  async stateRoots(): Promise<StateRoots> {
    return this._epochStateRoot;
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

  async useState(): Promise<FullState> {
    return this._state;
  }

  async applyIntentOperations(
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
