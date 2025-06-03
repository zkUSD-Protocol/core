import { Poseidon } from 'o1js';
import { IntentProof } from '../types/intent-proof.js';
import {
  StateRoots,
  NextStateCandidate,
  FullState,
  SystemParams,
  stateRootsEqual,
} from '../validator/block-state.js';
import { ValidatorDAInterface } from '../validator/da-interface.js';
import { LocalStateProxy } from '../validator/local-block-state.js';
import { StateStoreMetadata } from '../validator/sequencer-interface.js';
import { IntentProofStore } from './intent-proof-store.js';

type State = {
  state: FullState;
  metadata: StateStoreMetadata;
};

class DataAvailMock implements ValidatorDAInterface {
  // finalizedState  (old consensus state)
  private _finalizedState: State;
  // candidateState (validator proposition)
  private _candidateState: State | null;

  // accept validators candidate
  // candidate state moves to finalized state
  // candidate state is nullified
  acceptCandidate(): void {
    if (!this._candidateState) {
      throw new Error('No candidate state');
    }
    this._finalizedState = this._candidateState;
    this._candidateState = null;
  }

  denyCandidate(): void {
    this._candidateState = null;
  }

  // setNewConsensusState
  // finalized state is directly set
  setNewConsensusState(state: State): void {
    this._finalizedState = state;
  }

  private get _stateMap(): Map<string, State> {
    const map = new Map<string, State>();
    map.set(this._finalizedState.metadata.blockBlobId, this._finalizedState);
    if (this._candidateState) {
      map.set(this._candidateState.metadata.blockBlobId, this._candidateState);
    }
    return map;
  }

  private readonly _intentProofStore: IntentProofStore;
  private _inited: boolean;

  constructor(private readonly _systemParams: SystemParams) {
    this._inited = false;
  }

  async initDA(genesisStateRoots: StateRoots): Promise<StateStoreMetadata> {
    const genesisState = FullState.newGenesisState(this._systemParams);
    this._finalizedState = {
      state: genesisState,
      metadata: {
        blockBlobId: 'genesisBlockBlobId',
      },
    };
    this._inited = true;

    return {
      blockBlobId: 'genesisBlockBlobId',
    };
  }
  async syncViaBlockBlob(args: {
    localStateProxy: LocalStateProxy;
    blockBlobId: string;
  }): Promise<void> {
    if (!this._inited) {
      throw new Error('Data availability not initialized');
    }
    // find statet in map by metadata blob id
    const state = this._stateMap.get(args.blockBlobId);
    if (!state) {
      throw new Error('State not found');
    }
    args.localStateProxy.setState({
      finalizedState: state.state.clone(),
      finalizedStateStoreMetadata: state.metadata,
    });
  }

  async publishBlockUpdate(
    finalizedState: LocalStateProxy,
    nextBlockStateCandidate: NextStateCandidate
  ): Promise<StateStoreMetadata> {
    const currentStateRoots = this._finalizedState.state.roots();
    const candidateFinalizedStateRoots = await finalizedState.stateRoots();
    // check
    if (!currentStateRoots || !candidateFinalizedStateRoots) {
      throw new Error('Current state or candidate finalized state is null');
    }
    if (!stateRootsEqual(currentStateRoots, candidateFinalizedStateRoots)) {
      throw new Error(
        'Current state and candidate finalized state are not equal'
      );
    }

    if (this._candidateState) {
      throw new Error('Next state candidate already exists. Apply or remove.');
    }

    const candidateState = this._finalizedState.state.clone();
    candidateState.applyMapOperations(
      ...nextBlockStateCandidate.intentOperations
    );

    const hash = Poseidon.hash([
      candidateState.roots().vaultMapRoot,
      candidateState.roots().zkUsdMapRoot,
    ]).toString();

    this._candidateState = {
      state: candidateState,
      metadata: this.computeCandidateMetadata(hash),
    };

    return this._candidateState.metadata;
  }

  async getValidatorCandidateState(): Promise<State> {
    if (!this._candidateState) {
      throw new Error('No next state candidate');
    }
    return this._candidateState;
  }

  private computeCandidateMetadata(hash: string): StateStoreMetadata {
    return {
      blockBlobId: hash + 'candidateBlockBlobId',
    };
  }

  async setFinalizedState(state: FullState, metadata: StateStoreMetadata) {
    this._finalizedState = {
      state: state,
      metadata: metadata,
    };
  }

  async fetchIntentProof(intentBlobId: string): Promise<IntentProof> {
    const proof = await this._intentProofStore.getProof(intentBlobId);
    if (!proof) {
      throw new Error('Intent proof not found');
    }
    return proof;
  }

  async storeIntentProof(intentProof: IntentProof): Promise<string> {
    return this._intentProofStore.storeProof(intentProof);
  }
}
