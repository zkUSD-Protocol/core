import { Field } from "o1js/dist/node/lib/provable/field";
import { ZkUsdState } from "../data/state";
import { IntentCommitment } from "../optimistic-types";

export type SequencerEvent = {
    kind: 'intent';
    intentProofHash: string
} | {
    kind: 'epoch-end'
} | {
    kind: 'epoch-start';
    startingState: ZkUsdState;
}
    


export interface SequencerEventQueue  {
    fetchNextEvent(): Promise<SequencerEvent>;
}

export interface SequencerClient {
    getSequencerEventQueue(args: {zkusdMapRoot: Field}): Promise<SequencerEventQueue>;
    fetchLastEpochStart(): Promise<ZkUsdState>;
    commitToEpochState(args: {epochState: ZkUsdState}): Promise<void>;
}
