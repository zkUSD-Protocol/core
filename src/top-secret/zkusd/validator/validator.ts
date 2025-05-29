import {
  EpochFinalizedEvent,
  IntentEvent,
  SequencerInterface,
} from './sequencer-interface.js';
import { LocalStateProxy } from './local-epoch-state.js';
import { DataAvailInterface } from './data-avail-interface.js';
import { stateRootsEqual } from './epoch-state.js';
import { intentStateRootsMatchEpoch } from '../types/intent-proof.js';
import { OptimisticStateComputer } from './optimistic-state-computer.js';

export interface ValidatorRecovery {}

export interface ValidatorFailureManager {
  onError(error: unknown, recovery: ValidatorRecovery): Promise<void>;
}

export class Validator {
  private readonly _sequencer: SequencerInterface;
  private _finalizedEvent: EpochFinalizedEvent;
  private readonly _finalizedStateProxy: LocalStateProxy;
  private readonly _dataAvail: DataAvailInterface;
  private readonly _optimisticStateComputer: OptimisticStateComputer;
  private readonly _errorManager: ValidatorFailureManager;
  private _isRunning: boolean;

  private getRecoveryInterface(): ValidatorRecovery {
    return {};
  }

  constructor(
    sequencerClient: SequencerInterface,
    localEpochState: LocalStateProxy,
    dataAvailClient: DataAvailInterface,
    optimisticStateComputer: OptimisticStateComputer,
    errorManager: ValidatorFailureManager
  ) {
    this._sequencer = sequencerClient;
    this._finalizedStateProxy = localEpochState;
    this._dataAvail = dataAvailClient;
    this._optimisticStateComputer = optimisticStateComputer;
    this._errorManager = errorManager;
    this._isRunning = false;
  }

  async syncToEpochStart(epochBlobHandle?: string): Promise<void> {
    const epochState = await this._dataAvail.fetchFullEpochState(
      epochBlobHandle ??
        (await this._sequencer.fetchLastEpochStart()).epochStateBlobHandle
    );
    await this._finalizedStateProxy.setState(epochState);
    await this._optimisticStateComputer.setState(epochState);
  }

  async end(): Promise<void> {
    this._isRunning = false;
  }

  async start(): Promise<void> {
    this._isRunning = true;
    try {
      const eventQueue = await this._sequencer.getSequencerEventQueue(
        await this._finalizedStateProxy.stateRoots()
      );
      while (this._isRunning) {
        const event = await eventQueue.fetchNextEvent();
        switch (event.kind) {
          case 'epoch-end':
            await this.processEpochEnd();
            break;
          case 'epoch-finalized':
            this._finalizedEvent = event;
            await this.processEpochFinalized(event);
            break;
          case 'intent':
            await this.processIntent(event);
            break;
        }
      }
    } catch (error) {
      await this._errorManager.onError(error, this.getRecoveryInterface());
    }
  }

  async processEpochEnd(): Promise<void> {
    // get the computed state
    const computedState = await this._optimisticStateComputer.getState();
    // this state should be published to DA
    await this._dataAvail.publishEpochUpdate(
      computedState.previousEpochState.roots().epochBlobId,
      computedState.previousEpochState.roots().metadataBlobId,
      computedState.nextStateCandidate,
      this._finalizedStateProxy
    );
    // get the currently computed state and commit to it
    const nextEpochIncrementalState =
      await this._optimisticStateComputer.getStateCandidate();
    // commit the state roots
    await this._sequencer.commitToEpochState(
      nextEpochIncrementalState.toCommitment()
    );
  }

  async processEpochFinalized(epochFinalizedEvent: EpochFinalizedEvent): Promise<void> {
    // check the current state of the computed state
    // if it is not equal then fetch the new state and reset the computer state
    try {
      const computedState = await this._optimisticStateComputer.getState();
      // sanity check finalized state equals to the optimistic computer previous epoch state
      if (
        !this._finalizedStateProxy.rootsEqual(
          computedState.previousEpochState.roots()
        )
      ) {
        // fetch full state
        const newState = await this._dataAvail.fetchFullEpochState(
          epochFinalizedEvent.epochStateBlobHandle
        );
        await this._optimisticStateComputer.setState(newState);
        await this._finalizedStateProxy.setState(newState);
      }
      else if (
        !stateRootsEqual(
          computedState.nextStateCandidate.roots(),
          epochFinalizedEvent.epochStateRoots
        )
      ) {
        // the computed state candidate does not match the finalized state
        // - fetch the state and update the local finalized state
        await this._dataAvail.updateLocalFinalizedState(
          epochFinalizedEvent.epochStateBlobHandle,
          this._finalizedStateProxy
        );
        await this._optimisticStateComputer.setState(
          await this._finalizedStateProxy.useState()
        );
      } else {
        // if it is matching then the finalized state should be updated
        // with the computed state
        const stateCandidate =
          await this._optimisticStateComputer.getStateCandidate();
        await this._finalizedStateProxy.applyIntentOperations(
          stateCandidate.intentOperations
        );
      }
    } catch (error) {
      await this._errorManager.onError(error, this.getRecoveryInterface());
    }
  }

  async processIntent(intentEvent: IntentEvent): Promise<void> {
    // check if intent expected state is present
    try {
      const validPreconditions = intentStateRootsMatchEpoch(
        intentEvent.intentEpochStateRoots,
        (await this._finalizedStateProxy.useState()).roots()
      );

      if (validPreconditions) {
        try {
          const intentProof = await this._dataAvail.fetchIntentProof(
            intentEvent.intentBlobHandle
          );
          await this._optimisticStateComputer.step(intentProof);
        } catch (error) {
          await this._errorManager.onError(error, this.getRecoveryInterface());
        }
      } else {
        await this._errorManager.onError(
          new Error('Intent preconditions not met'),
          this.getRecoveryInterface()
        );
      }
    } catch (error) {
      await this._errorManager.onError(error, this.getRecoveryInterface());
    }
  }
}
