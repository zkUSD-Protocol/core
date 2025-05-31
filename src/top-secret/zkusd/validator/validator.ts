import {
  BlockFinalizedEvent,
  StateCommitment,
  IntentEvent,
  SequencerInterface,
} from './sequencer-interface.js';
import { LocalStateProxy } from './local-block-state.js';
import { DataAvailInterface } from './data-avail-interface.js';
import { stateRootsEqual } from './block-state.js';
import { OptimisticStateComputer } from './optimistic-state-computer.js';
import { IntentProofHelper } from '../types/intent-proof.js';

export interface ValidatorRecovery {}

export interface ValidatorFailureManager {
  onError(error: unknown, recovery: ValidatorRecovery): Promise<void>;
}

export class Validator {
  private readonly _sequencer: SequencerInterface;
  private _finalizedEvent?: BlockFinalizedEvent;
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
    localBlockState: LocalStateProxy,
    dataAvailClient: DataAvailInterface,
    optimisticStateComputer: OptimisticStateComputer,
    errorManager: ValidatorFailureManager
  ) {
    this._sequencer = sequencerClient;
    this._finalizedStateProxy = localBlockState;
    this._dataAvail = dataAvailClient;
    this._optimisticStateComputer = optimisticStateComputer;
    this._errorManager = errorManager;
    this._isRunning = false;
  }

  async syncToBlockStart(finalizedStateMetadata?: StateCommitment): Promise<void> {
    await this._dataAvail.syncToFinalizedState(
      {
        localStateProxy:this._finalizedStateProxy,
        metadataBlobId: finalizedStateMetadata ?
        finalizedStateMetadata.stateStoreMetadata.metadataBlobId :
        (await this._sequencer.fetchFinalizedStateCommitment()).stateStoreMetadata.metadataBlobId
      }
    );
    await this._optimisticStateComputer.setState(
      await this._finalizedStateProxy.cloneState()
    );
  }

  async end(): Promise<void> {
    this._isRunning = false;
  }

  async start(): Promise<void> {
    this._isRunning = true;
    try {
      const eventQueue = await this._sequencer.getSequencerEventQueue(

      );
      while (this._isRunning) {
        const event = await eventQueue.fetchNextEvent();
        switch (event.kind) {
          case 'block-end':
            await this.processBlockEnd();
            break;
          case 'block-finalized':
            this._finalizedEvent = event;
            await this.processBlockFinalized(event);
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

  async processBlockEnd(): Promise<void> {
    // get the computed state
    const computedState = await this._optimisticStateComputer.getStateCandidate()

    // this state should be published to DA
    const stateStoreMetadata = await this._dataAvail.publishBlockUpdate(
      this._finalizedStateProxy,
      computedState,
    );
    // metadata of the finalized state
    const finalizedStateMetadata =  await this._finalizedStateProxy.getStateCommitment();

    const stateCandidateMetadata = {
      stateRoots: computedState.nextBlockStateRoots,
      stateStoreMetadata,
    }

    // use DA metadata to commit to the state
    await this._sequencer.commitToBlockState(
      {
        finalizedStateMetadata,
        stateCandidateMetadata,
      }
    );
  }

  async processBlockFinalized(blockFinalizedEvent: BlockFinalizedEvent): Promise<void> {
    // check the current state of the computed state
    // if it is not equal then fetch the new state and reset the computer state
    try {
      const stateComputerFinalizedStateRoots = await this._optimisticStateComputer.getFinalizedStateRoots();
      const nextStateCandidate = await this._optimisticStateComputer.getStateCandidate();
      // sanity check finalized state equals to the optimistic computer previous block state
      if (
        !this._finalizedStateProxy.stateRootsEqual(
          stateComputerFinalizedStateRoots
        )
      ) {
        throw new Error('Finalized state does not match the optimistic computer previous block state');
      }
      else if (
        !stateRootsEqual(
          nextStateCandidate.nextBlockStateRoots,
          blockFinalizedEvent.finalizedStateMetadata.stateRoots
        )
      ) {
        // the computed state candidate does not match the finalized state
        // - fetch the state and update the local finalized state
        await this._dataAvail.syncToFinalizedState({
          localStateProxy: this._finalizedStateProxy,
          metadataBlobId: blockFinalizedEvent.finalizedStateMetadata.stateStoreMetadata.metadataBlobId
        });
        await this._optimisticStateComputer.setState(
          await this._finalizedStateProxy.cloneState()
        );
      } else {
        // if it is matching then the finalized state should be updated
        // with the computed state
        const stateCandidate =
          await this._optimisticStateComputer.getStateCandidate();
        await this._finalizedStateProxy.applyIntentOperations({
          finalizedBlockOperations: stateCandidate.intentOperations,
          finalizedStateStoreMetadata: blockFinalizedEvent.finalizedStateMetadata.stateStoreMetadata
        }
        );
      }
    } catch (error) {
      await this._errorManager.onError(error, this.getRecoveryInterface());
    }
  }

  async processIntent(intentEvent: IntentEvent): Promise<void> {
    try {
      // check if intent expected state is present
      const validPreconditions = IntentProofHelper.intentStateRootsMatchBlock({
        intentStateRoots: intentEvent.intentBlockStateRoots,
        blockStateRoots: await this._finalizedStateProxy.stateRoots()
      });

      if (validPreconditions) {
        try {
          const intentProof = await this._dataAvail.fetchIntentProof(
            intentEvent.intentBlobId
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
