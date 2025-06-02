import { NextStateCandidate, StateRoots } from './block-state.js';
import { IntentProof } from '../types/intent-proof.js';
import { LocalStateProxy } from './local-block-state.js';
import { StateCommitment, StateStoreMetadata } from './sequencer-interface.js';

/**
 * The validator's interface to the interactions with
 * the data availability layer.
 */
export interface DataAvailInterface {
  /**
   * Initializes the data availability chain.
   * It will create the first block blob and metadata blob.
   */
  initDA(genesisStateRoots: StateRoots): Promise<StateStoreMetadata>;

  /**
   * Fetches an intent proof from the data availability layer.
   */
  fetchIntentProof(intentBlobId: string): Promise<IntentProof>;

  /**
   * Syncs the local state to match the state referenced by the metadata blob.
   * This function handles all the complexity of determining what needs to be synced
   * and applies the necessary operations to bring the local state up to date.
   */
  syncViaBlockBlob(args: {
    localStateProxy: LocalStateProxy;
    blockBlobId: string;
  }): Promise<void>;

  /**
   * Publishes the incremental block update to the data availability layer.
   *
   * This function is creating a candidate for the finalised state
   * lets say we are submitting block 100
   * our checkpoint is block 99
   *
   */
  publishBlockUpdate(
    finalizedState: LocalStateProxy,
    nextBlockStateCandidate: NextStateCandidate
  ): Promise<StateStoreMetadata>;
}
