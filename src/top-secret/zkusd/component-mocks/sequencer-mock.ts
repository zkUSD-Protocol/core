import { BlockFinalizedEvent, SequencerEvent, SequencerEventQueue, SequencerInterface, StateCommitment } from "../validator/sequencer-interface";

export class SequencerMock implements SequencerInterface{

    private lastFinalizedStateEvent: BlockFinalizedEvent | null = null;

    private eventQueue = {eventsQueue: [] as SequencerEvent[]}
    
    async getSequencerEventQueue(finalizedStateMetadata?: StateCommitment): Promise<SequencerEventQueue> {
        return {
            fetchNextEvent: async () => {
                if(this.eventQueue.eventsQueue.length === 0){
                    throw new Error("No events in queue");
                }
                return this.eventQueue.eventsQueue.shift()!;
            }
        };
    }
    async fetchFinalizedStateCommitment(): Promise<StateCommitment> {
        if(!this.lastFinalizedStateEvent){
            throw new Error("No finalized state event");
        }
        return JSON.parse(JSON.stringify(this.lastFinalizedStateEvent.finalizedStateMetadata));
    }
    async commitToBlockState(args: { finalizedStateMetadata: StateCommitment; stateCandidateMetadata: StateCommitment; }): Promise<void> {
        // does nothing
    }

    pushEvent(event: SequencerEvent){
        this.eventQueue.eventsQueue.push(event);
        // if it is block finalized event, set it as last finalized state event
        if(event.kind === 'block-finalized'){
            this.lastFinalizedStateEvent = event;
        }
    }
}