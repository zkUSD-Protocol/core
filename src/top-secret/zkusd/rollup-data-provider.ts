import { IntentProof } from "./types/intent-proof.js";
import { IntentProofStore, SqliteIntentProofStore } from "./intent-proof-store.js";
import { IntentCommitment } from "./optimistic-types.js";

export interface RollupDataProvider {
  getIntentProof(c: IntentCommitment): Promise<IntentProof | null>;
  storeIntentProof(proof: IntentProof): Promise<void>;
}

export class RollupDataProviderImpl implements RollupDataProvider {
  constructor(private store: IntentProofStore) {}

  async getIntentProof(c: IntentCommitment): Promise<IntentProof | null> {
    return this.store.getProof(c.proofHash);
  }

  async storeIntentProof(proof: IntentProof): Promise<void> {
    this.store.storeProof(proof);
  }

  static create(store: IntentProofStore = new SqliteIntentProofStore()): RollupDataProvider {
    return new RollupDataProviderImpl(store);
  }
}
