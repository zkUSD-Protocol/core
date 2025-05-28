import { FullEpochState } from "./epoch-state.js";
import { IntentProof } from "../types/intent-proof.js";
import { IntentMapOperation } from "./map-operation.js";
import { IncrementalEpochState } from "./epoch-state.js";

export interface OptimisticStateComputer {
    setState(state: FullEpochState): Promise<void>;
    getState(): Promise<{previousEpochState: FullEpochState, nextEpochState: FullEpochState, newEpochOperations: IntentMapOperation[]}>;
    getIncrementalState(): Promise<IncrementalEpochState>;
    step(intentProof: IntentProof): Promise<void>;
}


export class NonProvingStateComputer implements OptimisticStateComputer {
    private _liveState: FullEpochState;
    private _epochState: FullEpochState;
    private _newEpochOperations: IntentMapOperation[];
    
    
    
    constructor() {
        
    }

    async setState(state: FullEpochState): Promise<void> {
        this._liveState = state;
        this._epochState = state;
        this._newEpochOperations = [];
    }
    async getState(): Promise<{previousEpochState: FullEpochState, nextEpochState: FullEpochState, newEpochOperations: IntentMapOperation[]}> {
        return {previousEpochState: this._epochState, nextEpochState: this._liveState, newEpochOperations: this._newEpochOperations};
    }
    async getIncrementalState(): Promise<IncrementalEpochState> {
        return new IncrementalEpochState(this._liveState.roots(), this._newEpochOperations);
    }
    async step(intentProof: IntentProof): Promise<void> {
        throw new Error('Not implemented');
    }
}