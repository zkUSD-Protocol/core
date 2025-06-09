import { deserializeEncryptedNote } from '../data/note.js';
import {
  BlockEndEvent,
  BlockFinalizedEvent,
  IntentEvent,
  SequencerEvent,
  SequencerEventQueue,
  SequencerInterface,
  StateCommitment,
} from '../interfaces/sequencer-interface.js';
import { StateRoots } from '../validator/block-state.js';
import { SubmitIntentParams, UserSequencerInterface } from './temp-user-interfaces.js';

export class SequencerMock implements SequencerInterface, UserSequencerInterface {
  private _validatedIntents: { intentSequence: number; partialStateRoots: StateRoots }[] = [];

  validateIntent(args: { intentSequence: number; partialStateRoots: StateRoots; }): Promise<void> {
    this._validatedIntents.push(args);
    return Promise.resolve();
  }

  validatedIntents(): { intentSequence: number; partialStateRoots: StateRoots }[] {
    return this._validatedIntents;
  }

  private lastFinalizedStateEvent: BlockFinalizedEvent | null = null;

  private eventQueue = { eventsQueue: [] as SequencerEvent[] };
  private _stateCandidateMetadata: StateCommitment | undefined;

  async getSequencerEventQueue(
    finalizedStateMetadata?: StateCommitment
  ): Promise<SequencerEventQueue> {
    return {
      fetchNextEvent: async () => {
        if (this.eventQueue.eventsQueue.length === 0) {
          throw new Error('No events in queue');
        }
        return this.eventQueue.eventsQueue.shift()!;
      },
    };
  }
  async fetchFinalizedStateCommitment(): Promise<StateCommitment> {
    if (!this.lastFinalizedStateEvent) {
      throw new Error('No finalized state event');
    }
    return JSON.parse(
      JSON.stringify(this.lastFinalizedStateEvent.finalizedStateMetadata)
    );
  }
  async commitToBlockState(args: {
    finalizedStateMetadata: StateCommitment;
    stateCandidateMetadata: StateCommitment;
  }): Promise<void> {
    this._stateCandidateMetadata = args.stateCandidateMetadata;
    // does nothing
  }


  public commitedCandidate(): StateCommitment | undefined {
    return this._stateCandidateMetadata;
  }

  public acceptCandidateAndFinalize() {
    if (!this._stateCandidateMetadata) {
      throw new Error('No state candidate metadata');
    }
    this.lastFinalizedStateEvent = {
      kind: 'block-finalized',
      finalizedStateMetadata: this._stateCandidateMetadata,
    };
    this.eventQueue.eventsQueue.push(this.lastFinalizedStateEvent);
    this._stateCandidateMetadata = undefined;
  }
  
  public pushEvent(event: BlockEndEvent | BlockFinalizedEvent) {
    this._pushEvent(event);
  }

  private _pushEvent(event: IntentEvent | BlockEndEvent | BlockFinalizedEvent) {
    this.eventQueue.eventsQueue.push(event);
    // if it is block finalized event, set it as last finalized state event
    if (event.kind === 'block-finalized') {
      this.lastFinalizedStateEvent = event;
    }
  }

  async submitIntent(intent: SubmitIntentParams): Promise<string> {
    const intentSequence = this.eventQueue.eventsQueue.length;
    const outputNotes = intent.encryptedNotes?.map((note) => deserializeEncryptedNote(JSON.parse(note)));
    // make a intent event out of it
    const intentEvent: IntentEvent = {
      kind: 'intent',
      intentBlobId: intent.intentBlobId,
      intentBlockStateRoots: intent.intentStateRoots,
      intentSequence,
      outputNotes: outputNotes ?? [],
    };
    this._pushEvent(intentEvent);
    return intentSequence.toString(); 
  }
}
