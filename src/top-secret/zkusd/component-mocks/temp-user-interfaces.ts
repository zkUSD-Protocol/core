import { IntentProof, IntentProofKind, IntentStateRoots } from "../types/intent-proof";

export type SubmitIntentParams = {
  intentType: IntentProofKind;
  intentBlobId: string;
  intentStateRoots: IntentStateRoots;
  encryptedNotes?: string[];
};

export interface UserSequencerInterface {
  submitIntent(intent: SubmitIntentParams): Promise<string>;
}

export interface UserDAInterface {
  /**
   * Publishes an intent proof to the data availability layer.
   * It will return the blob id of the intent proof.
   */
  publishIntentProof(intentProof: IntentProof): Promise<string>;
}
