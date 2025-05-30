import { StateRoots, FullState } from './block-state.js';
import { IntentMapOperation } from './map-operation.js';

export interface LocalStateProxy {
  setState(state: FullState): Promise<void>;

  useState(): Promise<FullState>;

  stateRoots(): Promise<StateRoots>;

  checkStoredRoots(StateRoots: StateRoots): Promise<boolean>;

  applyIntentOperations(
    finalizedBlockOperations: IntentMapOperation[]
  ): Promise<void>;

  rootsEqual(StateRoots: StateRoots): Promise<boolean>;
}

export class InMemoryStateProxy implements LocalStateProxy {
  private _state: FullState;
  private _blockStateRoot: StateRoots;

  constructor(initialState: FullState) {
    this._state = initialState;
    this._blockStateRoot = initialState.roots();
  }

  async stateRoots(): Promise<StateRoots> {
    return this._blockStateRoot;
  }

  async checkStoredRoots(StateRoots: StateRoots): Promise<boolean> {
    return (
      this._blockStateRoot.vaultMapRoot
        .equals(StateRoots.vaultMapRoot)
        .toBoolean() &&
      this._blockStateRoot.zkUsdMapRoot
        .equals(StateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }

  async setState(state: FullState): Promise<void> {
    this._state = state;
    this._blockStateRoot = state.roots();
  }

  async useState(): Promise<FullState> {
    return this._state;
  }

  async applyIntentOperations(
    finalizedBlockOperations: IntentMapOperation[]
  ): Promise<void> {
    this._state.applyMapOperations(...finalizedBlockOperations);
    this._blockStateRoot = this._state.roots();
  }

  async rootsEqual(StateRoots: StateRoots): Promise<boolean> {
    return (
      this._blockStateRoot.vaultMapRoot
        .equals(StateRoots.vaultMapRoot)
        .toBoolean() &&
      this._blockStateRoot.zkUsdMapRoot
        .equals(StateRoots.zkUsdMapRoot)
        .toBoolean()
    );
  }
}
