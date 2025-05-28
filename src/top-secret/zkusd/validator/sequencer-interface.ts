import { StateRoots, NextEpochStateCommitment } from './epoch-state.js';

/**
 * Represents an intent event from the sequencer queue.
 * Used to fetch and validate data relevant to an epoch.
 */
export interface IntentEvent {
  kind: 'intent';
  /** Handle to retrieve the intent blob from the data availability (DA) layer. */
  intentBlobHandle: string;
  /** State root to verify before fetching the associated intent data. */
  intentEpochStateRoots: StateRoots;
  /** Sequence number of the intent. */
  intentSequence: number;
}

/**
 * Represents an epoch-closed event from the sequencer queue.
 * Signals the end of an epoch.
 */
export interface EpochEndEvent {
  kind: 'epoch-end';
  /** Timestamp of the epoch end - required for DA file creation */
  timestamp: number;
  /** Intents hash of the epoch, sha256 */
  intentsHash: string;
}
/**
 * Represents the finalization of an epoch.
 * Signals the end of an epoch and the start of a new one.
 */
export interface EpochFinalizedEvent {
  kind: 'epoch-finalized';
  /** State root to match against the validator’s computed state. */
  epochStateRoots: StateRoots;
  /** Handle to retrieve the epoch state blob from DA. - This is actually the previous epoch file */
  epochStateBlobHandle: string;
  /** Handle to retrieve the metadata blob from DA. */
  metadataBlobHandle: string;
}

/**
 * Event from the sequencer queue.
 * Does not need to match the sequencer's emitted events exactly —
 * only contains the information required by the validator to process epochs.
 */
export type SequencerEvent = IntentEvent | EpochEndEvent | EpochFinalizedEvent;

/**
 * Allows a validator to await events from the sequencer.
 */
export interface SequencerEventQueue {
  /**
   * Fetches the next event from the sequencer.
   */
  fetchNextEvent(): Promise<SequencerEvent>;
}

/**
 * Validator's interface to the interactions with the sequencer data.
 */
export interface SequencerInterface {
  /**
   * Returns a queue of sequencer events.
   * If `epochStateRoots` is provided, returns events from that epoch onward.
   * Otherwise, starts from the last known epoch.
   */
  getSequencerEventQueue(args?: StateRoots): Promise<SequencerEventQueue>;

  /**
   * Returns the most recent 'epoch-start' event.
   */
  fetchLastEpochStart(): Promise<{
    epochStateRoots: StateRoots;
    epochStateBlobHandle: string;
  }>;

  /**
   * Commits the given epoch state root to the sequencer's consensus.
   * Should be called by the validator after successfully processing an epoch.
   */
  commitToEpochState(
    epochStateCommitment: NextEpochStateCommitment // include blobids
  ): Promise<void>;
}
