import { FullState, NextEpochStateCandidate } from './epoch-state.js';
import { IntentProof } from '../types/intent-proof.js';
import { FinalizedState } from './local-epoch-state.js';

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
   * It may do that by fetching the last state checkpoints and applies the map operations to get the final state.
   *
   */
  fetchFullEpochState(epochBlobHandle: string): Promise<FullState>;

  /**
   * Updates the local finalized state.
   * This function is called when the validator wants to update the local state with the state from DA.
   *
   */
  updateLocalFinalizedState(
    epochBlobHandle: string,
    finalizedState: FinalizedState
  ): Promise<void>;

  /**
   * Publishes the incremental epoch update to the data availability layer.
   *
   * This function is creating a candidate for the finalised state
   * lets say we are submitting epoch 100
   * our checkpoint is epoch 99
   *
   */
  publishEpochUpdate(
    previousEpochBlobId: string,
    metadataBlobId: string,
    nextEpochStateCandidate: NextEpochStateCandidate,
    finalizedState: FinalizedState
  ): Promise<DataAvailBlobIds>;
}
