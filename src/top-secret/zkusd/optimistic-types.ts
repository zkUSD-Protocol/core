import { Field } from "o1js";
import { ZkUsdState } from "./data/state.js";

export type IntentCommitment = {
  kind: 'intent-proof';
  intentStateRoots: IntentStateRoots;
  proofHash: string; // sha256
  commitmentId: string
};

export type IntentStateRoots = {
  vaultMapRoot?: Field;
  zkUsdMapRoot?: Field;
};

export type EpochEndSignal = {
  kind: 'epoch-end';
  epochNumber: number;
};

export interface StateProcessorLogReader {
  get items(): string[];
  toString(tail?: number): string;
}
export interface StateProcessorLog extends StateProcessorLogReader {
  push(item: string): void;
}

export type OptimisticState = {
  intentEpochState: ZkUsdState;
}

export type SystemStateEvent = IntentCommitment | EpochEndSignal;
