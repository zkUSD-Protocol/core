import { Poseidon } from 'o1js';
import { IntentProof } from '../types/intent-proof.js';
import {
  StateRoots,
  NextStateCandidate,
  FullState,
  SystemParams,
  stateRootsEqual,
} from '../validator/block-state.js';
import { ValidatorDAInterface } from '../interfaces/da-interface.js';
import { LocalStateProxy } from '../validator/local-block-state.js';
import { StateStoreMetadata } from '../interfaces/sequencer-interface.js';
import { IntentProofStore, SqliteIntentProofStore } from './intent-proof-store.js';
import { IntentMapOperation } from '../validator/map-operation.js';
import { UserDAInterface } from './temp-user-interfaces.js';

type State = {
  state: FullState;
  metadata: StateStoreMetadata;
};

export class DataAvailMock implements ValidatorDAInterface, UserDAInterface {
  // finalizedState  (old consensus state)
  private _finalizedState: State;
  // candidateState (validator proposition)
  private _candidateState: State | null;
  private _candidateStateOperations: IntentMapOperation[];

  public get candidateStateOperations(): IntentMapOperation[] {
    return this._candidateStateOperations;
  }

  public cloneFinalizedState(): State {
    return {
      state: this._finalizedState.state.clone(),
      metadata: this._finalizedState.metadata,
    };
  }

  public cloneCandidateState(): State | null {
    if (!this._candidateState) {
      return null;
    }
    return {
      state: this._candidateState.state.clone(),
      metadata: this._candidateState.metadata,
    };
  }

  // accept validators candidate
  // candidate state moves to finalized state
  // candidate state is nullified
  acceptCandidate(): void {
    if (!this._candidateState) {
      throw new Error('No candidate state');
    }
    this._finalizedState = this._candidateState;
    this._candidateState = null;
    this._candidateStateOperations = [];
  }

  denyCandidate(): void {
    this._candidateState = null;
    this._candidateStateOperations = [];
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
    this._intentProofStore = new SqliteIntentProofStore();
  }
  async publishIntentProof(intentProof: IntentProof): Promise<string> {
    return this._intentProofStore.storeProof(intentProof);
  }
  readFromWalrus(blobId: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  async initDA(genesisStateRoots: StateRoots): Promise<StateStoreMetadata> {
    const genesisState = FullState.newGenesisState(this._systemParams);
    // assert genesis roots match
    if (!genesisState.roots()) {
      throw new Error('Genesis state roots are null');
    }
    if (!genesisStateRoots) {
      throw new Error('Genesis state roots are null');
    }
    if (!stateRootsEqual(genesisState.roots(), genesisStateRoots)) {
      throw new Error('Genesis state roots do not match');
    }
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
      console.warn(
        'Current state and candidate finalized state are not equal',
        currentStateRoots,
        candidateFinalizedStateRoots
      );
    }

    if (this._candidateState) {
      throw new Error('Next state candidate already exists. Apply or remove.');
    }

    console.log('finalizedStateRoots', this._finalizedState.state.roots());
    console.log('nextBlockStateCandidateRoots', nextBlockStateCandidate.nextBlockStateRoots);

    const validatedOperations = nextBlockStateCandidate.intentOperations;
    console.log('validatedOperations', validatedOperations);

    const candidateState = this._finalizedState.state.clone();
    candidateState.applyMapOperations(
      ...validatedOperations
    );

    const hash = Poseidon.hash([
      candidateState.roots().vaultMapRoot,
      candidateState.roots().zkUsdMapRoot,
    ]).toString();

    this._candidateState = {
      state: candidateState,
      metadata: this.computeCandidateMetadata(hash),
    };
    this._candidateStateOperations = validatedOperations;

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
