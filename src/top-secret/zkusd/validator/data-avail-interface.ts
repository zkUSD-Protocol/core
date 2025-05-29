import { FullState, NextEpochStateCandidate, StateRoots } from './epoch-state.js';
import { IntentProof } from '../types/intent-proof.js';
import { LocalStateProxy } from './local-epoch-state.js';
import { SequencerStateMetadata } from './sequencer-interface.js';
import { IntentMapOperation } from './map-operation.js';

export type DataAvailBlobIds = {
  epochBlobId: string;
  metadataBlobId: string;
  checkpointBlobId?: string;
};

/**
 * The validator's interface to the interactions with
 * the data availability layer.
 */
export interface DataAvailInterface {
  /**
   * Fetches an intent proof from the data availability layer.
   */
  fetchIntentProof(intentBlobHandle: string): Promise<IntentProof>;

  /**
   * Fetches the full epoch state from the data availability layer.
   * It may do that by fetching the last state checkpoints 
   * and applying the map operations to get the final state.
   */
  fetchFullEpochState(epochBlobHandle: string): Promise<FullState>;

  /**
   * Given the last finalized state and the current finalized state,
   * this function returns the map operations that need to be applied to the last finalized state
   * to get the current finalized state.
   */
  updateLocalStateToFinalizedState(
    args: {
      epochFinalizedEventStateMetadata: SequencerStateMetadata,
      localFinalizedStateMetadata: SequencerStateMetadata,
    }
    // TODO errors
  ): Promise<{operationsToApply: IntentMapOperation[]}>;

  /**
   * Publishes the incremental epoch update to the data availability layer.
   *
   * This function is creating a candidate for the finalised state
   * lets say we are submitting epoch 100
   * our checkpoint is epoch 99
   *
   */
  publishEpochUpdate(
    finalizedStateMetadata: SequencerStateMetadata,
    nextStateValidatedIntentOperations: IntentMapOperation[],
    nextStateRoots: StateRoots,
  ): Promise<DataAvailBlobIds>;
}
