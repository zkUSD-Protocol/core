import { EpochState } from "./epoch-state.js";

export interface LocalEpochState {

    setState(state: EpochState): Promise<void>;

    getState(): Promise<EpochState>;

}

export class InMemoryLocalEpochState implements LocalEpochState {
    
    private _state: EpochState;

    constructor(initialState: EpochState) {
        this._state = initialState;
    }

    async setState(state: EpochState): Promise<void> {
        this._state = state;
    }

    async getState(): Promise<EpochState> {
        return this._state;
    }
}
    
