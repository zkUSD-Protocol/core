import { EpochState } from '../../data/epoch-state.js';
import { AnyIntentProof } from '../../types/intent-proof.js';

/**
 * The validator's final interface to the interactions with
 * the data availability layer.
 */
export interface DataAvailabilityInterface {
  /**
   * Fetches an intent proof from the data availability layer.
   */
  fetchIntentProof(intentBlobHandle: string): Promise<AnyIntentProof>;

  /**
   * Fetches the full epoch state from the data availability layer.
   */
  fetchFullEpochState(
    metadataBlobHandle: string,
    epochNumber: number
  ): Promise<EpochState>;

  /**
   * Publishes the final epoch state to the data availability layer.
   */
  publishFinalEpochState(computedEpochState: EpochState): Promise<void>;
}
