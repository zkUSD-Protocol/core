import { StateRoots } from './block-state.js';

export type SequencerStateMetadata = {
  /** State root to match against the validator’s computed state. */
  stateRoots: StateRoots;
  /** Handle to retrieve the block state blob from DA. - This is actually the previous block file */
  stateBlobHandle: string;
};

/**
 * Represents an intent event from the sequencer queue.
 * Used to fetch and validate data relevant to an block.
 */
export interface IntentEvent {
  kind: 'intent';
  /** Handle to retrieve the intent blob from the data availability (DA) layer. */
  intentBlobHandle: string;
  /** State root to verify before fetching the associated intent data. */
  // TODO will intents with invalid state roots be even accepted by SUI contracts?
  intentBlockStateRoots: StateRoots;
  /** Sequence number of the intent. */
  intentSequence: number;
}

/**
 * Represents an block-closed event from the sequencer queue.
 * Signals the end of an block.
 */
export interface BlockEndEvent {
  kind: 'block-end';
  /** Timestamp of the block end - required for DA file creation */
  timestamp: number;
  /** Intents hash of the block, sha256 */
  intentsHash: string;
}
/**
 * Represents the finalization of an block.
 * Signals the end of an block and the start of a new one.
 */
export interface BlockFinalizedEvent {
  kind: 'block-finalized';
  /** Metadata of the state after the block */
  finalizedStateMetadata: SequencerStateMetadata;
}

/**
 * Event from the sequencer queue.
 * Does not need to match the sequencer's emitted events exactly —
 * only contains the information required by the validator to process blocks.
 */
export type SequencerEvent = IntentEvent | BlockEndEvent | BlockFinalizedEvent;

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
   * If `blockStateMetadata` is provided, returns events from that block onward.
   * Otherwise, starts from the last known block.
   */
  getSequencerEventQueue(
    blockStateMetadata?: SequencerStateMetadata
  ): Promise<SequencerEventQueue>;

  /**
   * Returns the most recent 'block-start' event.
   */
  fetchFinalizedStateBlockMetadata(): Promise<SequencerStateMetadata>;

  /**
   * Commits the given block state root to the sequencer's consensus.
   * Should be called by the validator after successfully processing an block.
   */
  commitToBlockState(
    /** Metadata of the finalized (previous) block state */
    finalizedStateMetadata: SequencerStateMetadata,

    /** Metadata of the candidate (next) block state */
    stateCandidateMetadata: SequencerStateMetadata
  ): Promise<void>;
}
