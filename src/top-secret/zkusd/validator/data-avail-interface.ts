import { FullEpochState, IncrementalEpochState } from "./epoch-state.js";
import { IntentProof } from "../types/intent-proof.js";
import { FinalizedEpochState } from "./local-epoch-state.js";

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
    fetchFullEpochState(epochBlobHandle: string): Promise<FullEpochState>;

    /**
     * Fetches the incremental epoch update from the data availability layer,
     * and applies the map operations to the given epoch state.
     */
    updateFinalizedEpochState(epochBlobHandle: string, finalizedEpochState: FinalizedEpochState): Promise<void>;   

    /**
     * Publishes the incremental epoch update to the data availability layer.
     */
    publishIncrementalEpochUpdate(computedEpochState: IncrementalEpochState): Promise<void>;
    
}