import { EpochStartEvent, EpochStateRoots, IntentEvent, SequencerInterface } from "./sequencer-interface.js";
import { LocalEpochState } from "./local-epoch-state.js";
import { DataAvailInterface } from "./data-avail-interface.js";
import { FullEpochState } from "./epoch-state.js";
import { IntentProof } from "../types/intent-proof.js";


export interface OptimisticStateComputer {
    setState(state: FullEpochState): Promise<void>;
    getState(): Promise<FullEpochState>;
    step(intentProof: IntentProof): Promise<void>;
}

export interface ValidatorRecovery {
    
}

export interface ValidatorFailureManager {
    onError(error: unknown, recovery: ValidatorRecovery): Promise<void>;
}

export class Validator {

    private readonly _sequencer: SequencerInterface;
    private readonly _localEpochState: LocalEpochState;
    private readonly _dataAvail: DataAvailInterface;
    private readonly _optimisticStateComputer: OptimisticStateComputer;
    private readonly _errorManager: ValidatorFailureManager;
    private _isRunning: boolean;
    
    private getRecoveryInterface(): ValidatorRecovery {
        return {
            
        }
    }
    
    constructor(
        sequencerClient: SequencerInterface,
        localEpochState: LocalEpochState,
        dataAvailClient: DataAvailInterface,
        optimisticStateComputer: OptimisticStateComputer,
        errorManager: ValidatorFailureManager
    ){
        this._sequencer = sequencerClient;
        this._localEpochState = localEpochState;
        this._dataAvail = dataAvailClient;
        this._optimisticStateComputer = optimisticStateComputer;
        this._errorManager = errorManager;
        this._isRunning = false;
    }
    
    async syncToEpochStart(epochBlobHandle?: string): Promise<void>{
        const epochState = await this._dataAvail.fetchFullEpochState(epochBlobHandle ?? (await this._sequencer.fetchLastEpochStart()).epochStateBlobHandle);
        await this._localEpochState.setState(epochState);
    }


    async start(initialEpochStateHash?: EpochStateRoots): Promise<void>{
        this._isRunning = true;
        try{
        const eventQueue = await this._sequencer.getSequencerEventQueue(initialEpochStateHash);
        while(this._isRunning){
            const event = await eventQueue.fetchNextEvent();
            switch(event.kind){
                case 'epoch-end':
                    await this.processEpochEnd();
                    break;
                case 'epoch-start':
                    await this.processEpochStart(event);
                    break;
                case 'intent':
                    await this.processIntent(event);
                    break;
            }
        }
    }
    catch(error){
        await this._errorManager.onError(error, this.getRecoveryInterface());
    }
    }

    async processEpochEnd(): Promise<void>{
        // get the currently computed state and commit to it
        const epochState = await this._optimisticStateComputer.getState()
        // save locally
        await this._localEpochState.setState(epochState);
        await this._sequencer.commitToEpochState(epochState.roots());
    }

    async processEpochStart(epochStartEvent: EpochStartEvent): Promise<void>{
        // check the current state of the computed state
        // if it is not equal then fetch the new state and reset the computer state
        try{
        if(!this._localEpochState.checkStoredRoots(epochStartEvent.epochStateRoots)){
            const newState = await this._dataAvail.fetchFullEpochState(epochStartEvent.epochStateBlobHandle);
            await this._optimisticStateComputer.setState(newState);
            await this._localEpochState.setState(newState);
        }
        else {
            // if it is matching then the local state should be commited to DA    
            await this._dataAvail.publishFinalEpochState(await this._localEpochState.getState());
        }
        }
        catch(error){
            await this._errorManager.onError(error, this.getRecoveryInterface());
        }
    }

    async processIntent(intentEvent: IntentEvent): Promise<void>{

        const intentProof = await this._dataAvail.fetchIntentProof(intentEvent.intentBlobHandle);

    // make a step of the state computation
    try{
        await this._optimisticStateComputer.step(intentProof);
    }
    catch(error){
        await this._errorManager.onError(error, this.getRecoveryInterface());
    }
    
    }    
}    