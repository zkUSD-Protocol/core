import { Field } from "o1js";
import { SequencerClient } from "./sequencer-client.js";
import { LocalEpochState } from "./local-epoch-state.js";
import { DataAvailClient } from "./data-avail-client.js";

export class Validator {

    private readonly _sequencerClient: SequencerClient;
    private readonly _localEpochState: LocalEpochState;
    private _localEpochStateHash: {zkusdMapRoot: Field};
    private readonly _dataAvailClient: DataAvailClient;
    
    constructor(
        sequencerClient: SequencerClient,
        localEpochState: LocalEpochState,
        dataAvailClient: DataAvailClient
    ){
        this._sequencerClient = sequencerClient;
        this._localEpochState = localEpochState;
        this._dataAvailClient = dataAvailClient;
    }
    
    async syncToEpochStart(args?: {zkusdMapRoot: Field}): Promise<void>{

        const epochRoot = args?.zkusdMapRoot ?? (await this._localEpochState.getState()).state.intentZkUsdMapRoot;
        const epochState = await this._dataAvailClient.fetchFinalEpochState({zkusdMapRoot: epochRoot});
        this._localEpochStateHash = {zkusdMapRoot: epochState.state.intentZkUsdMapRoot};
        await this._localEpochState.setState(epochState);

    }

    async computeFinalEpochState(timeoutSec?: number): Promise<void>{

        const eventQueue = await this._sequencerClient.getSequencerEventQueue({zkusdMapRoot: this._localEpochStateHash.zkusdMapRoot});

        while(true){
            const event = await eventQueue.fetchNextEvent();
            switch(event.kind){
                case 'epoch-end':
                    break;
                case 'epoch-start':
                    break;
                case 'intent':
                    break;
            }
        }



    }
    
}    