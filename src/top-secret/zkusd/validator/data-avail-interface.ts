import { FullEpochState } from "./epoch-state.js";
import { IntentProof } from "../types/intent-proof.js";

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
     */
    fetchFullEpochState(epochBlobHandle: string): Promise<FullEpochState>;

    /**
     * Publishes the final epoch state to the data availability layer.
     */
    publishFinalEpochState(computedEpochState: FullEpochState): Promise<void>;
    
}