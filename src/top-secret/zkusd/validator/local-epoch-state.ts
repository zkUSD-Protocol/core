import { EpochStateRoots } from "./sequencer-interface";
import { FullEpochState } from "./epoch-state";

export interface LocalEpochState {

    setState(state: FullEpochState): Promise<void>;

    getState(): Promise<FullEpochState>;

    checkStoredRoots(epochStateRoots: EpochStateRoots): Promise<boolean>;

}

export class InMemoryLocalEpochState implements LocalEpochState {
    
    private _state: FullEpochState;
    private _epochStateRoot: EpochStateRoots;

    constructor(initialState: FullEpochState) {
        this._state = initialState;
        this._epochStateRoot = initialState.roots();
    
    }
   
    async checkStoredRoots(epochStateRoots: EpochStateRoots): Promise<boolean> {
        return this._epochStateRoot.vaultMapRoot.equals(epochStateRoots.vaultMapRoot).toBoolean() && this._epochStateRoot.zkUsdMapRoot.equals(epochStateRoots.zkUsdMapRoot).toBoolean();
    }

    async setState(state: FullEpochState): Promise<void> {
        this._state = state;
        this._epochStateRoot = state.roots();
    }

    async getState(): Promise<FullEpochState> {
        return this._state;
    }
}
    
