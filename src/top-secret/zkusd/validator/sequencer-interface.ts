import { Field } from "o1js";

/**
 * Represents an intent event from the sequencer queue.
 * Used to fetch and validate data relevant to an epoch.
 */
export interface IntentEvent {
  kind: 'intent';
  /** Handle to retrieve the intent blob from the data availability (DA) layer. */
  intentBlobHandle: string;
  /** State root to verify before fetching the associated intent data. */
  intentEpochStateRoots: EpochStateRoots;
}

/**
 * Represents an epoch-opened event from the sequencer queue.
 * Signals the start of a new epoch.
 */
export interface EpochStartEvent {
  kind: 'epoch-start';
  /** State root to match against the validator’s computed state. */
  epochStateRoots: EpochStateRoots;
  /** Handle to retrieve the epoch state blob from DA. */
  epochStateBlobHandle: string;
}

/**
 * Represents an epoch-closed event from the sequencer queue.
 * Signals the end of an epoch.
 */
export interface EpochEndEvent {
  kind: 'epoch-end';
}

/**
 * Event from the sequencer queue.
 * Does not need to match the sequencer's emitted events exactly —
 * only contains the information required by the validator to process epochs.
 */
export type SequencerEvent = IntentEvent | EpochStartEvent | EpochEndEvent;

/**
 * Identifies the state of an epoch using its state root.
 */
export type EpochStateRoots = {
  zkUsdMapRoot: Field;
  vaultMapRoot: Field;
};

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
  getSequencerEventQueue(
    args?: EpochStateRoots
  ): Promise<SequencerEventQueue>;

  /**
   * Returns the most recent 'epoch-start' event.
   */
  fetchLastEpochStart(): Promise<{
    epochStateRoots: EpochStateRoots;
    epochStateBlobHandle: string;
  }>;

  /**
   * Commits the given epoch state root to the sequencer's consensus.
   * Should be called by the validator after successfully processing an epoch.
   */
  commitToEpochState(args: EpochStateRoots): Promise<void>;
}