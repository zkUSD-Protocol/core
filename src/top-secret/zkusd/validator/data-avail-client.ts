import { Field } from "o1js";
import { EpochState } from "./epoch-state";
import { AnyIntentProof } from "../types/intent-proof";

export interface DataAvailClient {

    fetchIntentProof(proofHash: string): Promise<AnyIntentProof>;
    fetchFinalEpochState(args:{
        zkusdMapRoot: Field,
    }): Promise<EpochState>;
    publishFinalEpochState(args: EpochState): Promise<void>;
    
}