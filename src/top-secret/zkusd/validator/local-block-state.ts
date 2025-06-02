import { StateRoots, FullState, stateRootsEqual } from './block-state.js';
import { IntentMapOperation } from './map-operation.js';
import { StateCommitment, StateStoreMetadata } from './sequencer-interface.js';

export interface LocalStateProxyInitializer {
  create(): LocalStateProxy;
}

/**
 * This is the interface through which you interact with a locally available
 * full-state of ZKUSD, like system parameters of maps.
 * This state is a finalized state - meaning that it inderwent the consensus
 * and for a given block was an actual state of the system, not only a candidate.
 * The interface makes sure that you always provide a data availability handles
 * via which you can find the state globally.
 */
export interface LocalStateProxy {
  cloneState(): Promise<FullState>;
  setState(args: {
    finalizedState: FullState;
    finalizedStateStoreMetadata: StateStoreMetadata;
  }): Promise<void>;

  getStateCommitment(): Promise<StateCommitment>;

  useState(): Promise<FullState>;

  stateRoots(): Promise<StateRoots>;

  stateRootsEqual(stateRoots: StateRoots): Promise<boolean>;

  applyIntentOperations(args: {
    finalizedBlockOperations: IntentMapOperation[];
    finalizedStateStoreMetadata: StateStoreMetadata;
  }): Promise<void>;
}

export class InMemoryStateProxy implements LocalStateProxy {
  private _state: FullState;
  private _stateStoreMetadata: StateStoreMetadata;

  constructor(
    initialState: FullState,
    initialStateStoreMetadata: StateStoreMetadata
  ) {
    this._state = initialState;
    this._stateStoreMetadata = initialStateStoreMetadata;
  }

  async cloneState(): Promise<FullState> {
    return this._state.clone();
  }

  async getStateCommitment(): Promise<StateCommitment> {
    return {
      stateRoots: this._state.roots(),
      stateBlobHandle: this._stateStoreMetadata.blockBlobId,
    };
  }

  async stateRoots(): Promise<StateRoots> {
    return this._state.roots();
  }

  async stateRootsEqual(stateRoots: StateRoots): Promise<boolean> {
    return stateRootsEqual(await this.stateRoots(), stateRoots);
  }

  async setState(args: {
    finalizedState: FullState;
    finalizedStateStoreMetadata: StateStoreMetadata;
  }): Promise<void> {
    this._state = args.finalizedState;
    this._stateStoreMetadata = args.finalizedStateStoreMetadata;
  }

  async useState(): Promise<FullState> {
    return this._state;
  }

  async applyIntentOperations(args: {
    finalizedBlockOperations: IntentMapOperation[];
    finalizedStateStoreMetadata: StateStoreMetadata;
  }): Promise<void> {
    this._state.applyMapOperations(...args.finalizedBlockOperations);
    this._stateStoreMetadata = args.finalizedStateStoreMetadata;
  }
}
