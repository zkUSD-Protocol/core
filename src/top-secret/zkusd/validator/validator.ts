import { EpochStartEvent, IntentEvent, SequencerInterface } from "./sequencer-interface.js";
import { FinalizedEpochState } from "./local-epoch-state.js";
import { DataAvailInterface } from "./data-avail-interface.js";
import { stateRootsEqual } from "./epoch-state.js";
import { intentStateRootsMatchEpoch } from "../types/intent-proof.js";
import { OptimisticStateComputer } from "./optimistic-state-computer.js";


export interface ValidatorRecovery {
    
}

export interface ValidatorFailureManager {
    onError(error: unknown, recovery: ValidatorRecovery): Promise<void>;
}

export class Validator {

    private readonly _sequencer: SequencerInterface;
    private readonly _finalizedEpochState: FinalizedEpochState;
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
        localEpochState: FinalizedEpochState,
        dataAvailClient: DataAvailInterface,
        optimisticStateComputer: OptimisticStateComputer,
        errorManager: ValidatorFailureManager
    ){
        this._sequencer = sequencerClient;
        this._finalizedEpochState = localEpochState;
        this._dataAvail = dataAvailClient;
        this._optimisticStateComputer = optimisticStateComputer;
        this._errorManager = errorManager;
        this._isRunning = false;
    }
    
    async syncToEpochStart(epochBlobHandle?: string): Promise<void>{
        const epochState = await this._dataAvail.fetchFullEpochState(epochBlobHandle ?? (await this._sequencer.fetchLastEpochStart()).epochStateBlobHandle);
        await this._finalizedEpochState.setState(epochState);
        await this._optimisticStateComputer.setState(epochState);
    }

    async end(): Promise<void>{
        this._isRunning = false;
    }

    async start(): Promise<void>{
        this._isRunning = true;
        try{
            const finalizedState = await this._finalizedEpochState.getState();
            const eventQueue = await this._sequencer.getSequencerEventQueue(finalizedState.roots());
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
        const nextEpochIncrementalState = await this._optimisticStateComputer.getIncrementalState()
        // commit the state roots 
        await this._sequencer.commitToEpochState(nextEpochIncrementalState.toCommitment());
    }

    async processEpochStart(epochStartEvent: EpochStartEvent): Promise<void>{
        // check the current state of the computed state
        // if it is not equal then fetch the new state and reset the computer state
        try{
            const computedState = await this._optimisticStateComputer.getState();
            // sanity check finalized state equals to the optimistic computer previous epoch state 
            if(!this._finalizedEpochState.rootsEqual(computedState.previousEpochState.roots())){
                // fetch full state
                const newState = await this._dataAvail.fetchFullEpochState(epochStartEvent.epochStateBlobHandle);
                await this._optimisticStateComputer.setState(newState);
                await this._finalizedEpochState.setState(newState);
            }            
            // the computed next epoch does not match the consensus epoch state
            else if(!stateRootsEqual(computedState.nextEpochState.roots(), epochStartEvent.epochStateRoots)){
                await this._dataAvail.updateFinalizedEpochState(epochStartEvent.epochStateBlobHandle, this._finalizedEpochState);
                await this._optimisticStateComputer.setState(await this._finalizedEpochState.getState());
            }
        else {
            // if it is matching then the local state should be commited to DA    
            // and the finalized state should be updated
            const incrementalState = await this._optimisticStateComputer.getIncrementalState();
            await this._dataAvail.publishIncrementalEpochUpdate(incrementalState);
            await this._finalizedEpochState.updateEpochState(incrementalState.mapOperations);
        }
        }
        catch(error){
            await this._errorManager.onError(error, this.getRecoveryInterface());
        }
    }

    async processIntent(intentEvent: IntentEvent): Promise<void>{
        // check if intent expected state is present
    try{
        const validPreconditions = intentStateRootsMatchEpoch(intentEvent.intentEpochStateRoots,
             (await this._finalizedEpochState.getState()).roots());

        if(validPreconditions){
            try{
                const intentProof = await this._dataAvail.fetchIntentProof(intentEvent.intentBlobHandle);
                await this._optimisticStateComputer.step(intentProof);
            }
            catch(error){
                await this._errorManager.onError(error, this.getRecoveryInterface());
            }
        }
        else {
            await this._errorManager.onError(new Error('Intent preconditions not met'), this.getRecoveryInterface());
        }
    }
    catch(error){
        await this._errorManager.onError(error, this.getRecoveryInterface());
    }
    
    }    
}    