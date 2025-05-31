import { FullState, StateRoots } from './block-state.js';
import { IntentProof, IntentProofHelper } from '../types/intent-proof.js';
import { IntentMapOperation } from './map-operation.js';
import { NextStateCandidate } from './block-state.js';
import { ZkUsdState } from '../data/state.js';

type ProofHandler<P extends IntentProof> = (proof: P) => Promise<void>;

export interface OptimisticStateComputer {
  getFinalizedStateRoots(): StateRoots;
  setState(state: FullState): Promise<void>;
  getState(): Promise<{
    previousBlockState: FullState;
    nextStateCandidate: FullState;
    newBlockOperations: IntentMapOperation[];
  }>;
  getStateCandidate(): Promise<NextStateCandidate>;
  step(intentProof: IntentProof): Promise<void>;
}

export class NonProvingStateComputer implements OptimisticStateComputer {
  private _liveState: FullState;
  private _blockState: FullState;
  private _newBlockOperations: IntentMapOperation[];
  private _rollupProofState: ZkUsdState;

  constructor() {}
    getFinalizedStateRoots(): StateRoots {
        return this._blockState.roots();
    }

  async setState(state: FullState): Promise<void> {
    this._liveState = state;
    this._blockState = state;
    this._rollupProofState = state.toRollupProofState();
    this._newBlockOperations = [];
  }
  async getState(): Promise<{
    previousBlockState: FullState;
    nextStateCandidate: FullState;
    newBlockOperations: IntentMapOperation[];
  }> {
    return {
      previousBlockState: this._blockState,
      nextStateCandidate: this._liveState,
      newBlockOperations: this._newBlockOperations,
    };
  }
  async getStateCandidate(): Promise<NextStateCandidate> {
    return new NextStateCandidate(
      this._liveState.roots(),
      this._newBlockOperations,
    );
  }

  /*
  Processes the intent proof and updates the state.
  It will first verify the proof and disregard it if
  it cannot be verified.
  */
  async step(intentProof: IntentProof): Promise<void> {

    let verified = false;
    try{
    intentProof.proof.verify()
    verified = true;
    }catch(e){
      console.warn( `Error verifying ${intentProof.kind} proof: ${e}`);
      return;
    }

    // the proof is verified, double check the input state
    const intentProofHelper = new IntentProofHelper(this._blockState.systemParams);
    if (!intentProofHelper.rootsMatch(intentProof, this._blockState.roots())) {
      console.warn(`Intent proof input state does not match block state: ${IntentProofHelper.hash(intentProof)}`);
      return;
    }

    const operations = intentProofHelper.extractOperations(intentProof);
    this._newBlockOperations.push(...operations);
    // apply operations to the live state
    this._liveState.applyMapOperations(...operations);
  }
  
}
