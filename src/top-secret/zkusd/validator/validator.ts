import {
  BlockFinalizedEvent,
  StateCommitment,
  IntentEvent,
  SequencerInterface,
} from '../interfaces/sequencer-interface.js';
import { LocalStateProxy } from './local-block-state.js';
import { ValidatorDAInterface } from '../interfaces/da-interface.js';
import { stateRootsEqual } from './block-state.js';
import { OptimisticStateComputer } from './optimistic-state-computer.js';
import { IntentProofHelper } from '../types/intent-proof.js';

export interface ValidatorRecovery {}

export interface ValidatorFailureManager {
  onError(error: unknown, recovery: ValidatorRecovery): Promise<void>;
}

export class ProvisionalFailureManager implements ValidatorFailureManager {
  onError(error: unknown, recovery: ValidatorRecovery): Promise<void> {
    // just log the details nicely
    console.error(error); 
    return Promise.resolve();
  }
}

export class Validator {
  private readonly _sequencer: SequencerInterface;
  private readonly _finalizedStateProxy: LocalStateProxy;
  private readonly _dataAvail: ValidatorDAInterface;
  private readonly _optimisticStateComputer: OptimisticStateComputer;
  private readonly _errorManager: ValidatorFailureManager;

  private getRecoveryInterface(): ValidatorRecovery {
    return {};
  }

  constructor(
    sequencerClient: SequencerInterface,
    localBlockState: LocalStateProxy,
    dataAvailClient: ValidatorDAInterface,
    optimisticStateComputer: OptimisticStateComputer,
    errorManager: ValidatorFailureManager
  ) {
    this._sequencer = sequencerClient;
    this._finalizedStateProxy = localBlockState;
    this._dataAvail = dataAvailClient;
    this._optimisticStateComputer = optimisticStateComputer;
    this._errorManager = errorManager;
  }

  async init(){
    await this._optimisticStateComputer.setState(
      await this._finalizedStateProxy.cloneState()
    );
  }

  async syncToBlockStart(
    finalizedStateMetadata?: StateCommitment
  ): Promise<void> {
    await this._dataAvail.syncViaBlockBlob({
      localStateProxy: this._finalizedStateProxy,
      blockBlobId: finalizedStateMetadata
        ? finalizedStateMetadata.stateBlobHandle
        : (await this._sequencer.fetchFinalizedStateCommitment())
            .stateBlobHandle,
    });
    await this._optimisticStateComputer.setState(
      await this._finalizedStateProxy.cloneState()
    );
  }

async processNextBlock(): Promise<void> {
  const eventQueue = await this._sequencer.getSequencerEventQueue();
  const bufferedIntents: IntentEvent[] = [];
  let blockStarted = false;
  let blockEnded = false;

  try {
    while (!blockEnded) {
      const event = await eventQueue.fetchNextEvent();

      switch (event.kind) {
        case 'intent':
          if (!blockStarted) {
            // Buffer intent events until the block-finalized arrives
            bufferedIntents.push(event);
          } else {
            // Process intents immediately after block-finalized
            await this.processIntent(event);
          }
          break;

        case 'block-finalized':
          // Start of a new block
          blockStarted = true;

          // Process block-finalized first
          await this.processBlockFinalized(event);

          // Now process all buffered intents
          for (const intent of bufferedIntents) {
            await this.processIntent(intent);
          }
          bufferedIntents.length = 0; // clear the buffer
          break;

        case 'block-end':
          blockEnded = true;
          await this.processBlockEnd();
          break;

        default:
          console.warn(`Unknown event type: ${event}`);
      }
    }
  } catch (error) {
    await this._errorManager.onError(error, this.getRecoveryInterface());
  }
}
    
  
  async processBlockEnd(): Promise<void> {
    // get the computed state
    const computedState =
      await this._optimisticStateComputer.getStateCandidate();

    // this state should be published to DA
    const stateStoreMetadata = await this._dataAvail.publishBlockUpdate(
      this._finalizedStateProxy,
      computedState
    );
    // metadata of the finalized state
    const finalizedStateMetadata =
      await this._finalizedStateProxy.getStateCommitment();

    const stateCandidateMetadata = {
      stateRoots: computedState.nextBlockStateRoots,
      stateBlobHandle: stateStoreMetadata.blockBlobId,
    };

    // use DA metadata to commit to the state
    await this._sequencer.commitToBlockState({
      finalizedStateMetadata,
      stateCandidateMetadata,
    });
  }

  async processBlockFinalized(
    blockFinalizedEvent: BlockFinalizedEvent
  ): Promise<void> {
    // check the current state of the computed state
    // if it is not equal then fetch the new state and reset the computer state
    try {
      const stateComputerFinalizedStateRoots =
        await this._optimisticStateComputer.getFinalizedStateRoots();
      const nextStateCandidate =
        await this._optimisticStateComputer.getStateCandidate();
      // sanity check finalized state equals to the optimistic computer previous block state
      if (
        !this._finalizedStateProxy.stateRootsEqual(
          stateComputerFinalizedStateRoots
        )
      ) {
        throw new Error(
          'Finalized state does not match the optimistic computer previous block state'
        );
      } else if (
        !stateRootsEqual(
          nextStateCandidate.nextBlockStateRoots,
          blockFinalizedEvent.finalizedStateMetadata.stateRoots
        )
      ) {
        // the computed state candidate does not match the finalized state
        // - fetch the state and update the local finalized state
        await this._dataAvail.syncViaBlockBlob({
          localStateProxy: this._finalizedStateProxy,
          blockBlobId:
            blockFinalizedEvent.finalizedStateMetadata.stateBlobHandle,
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
          finalizedStateStoreMetadata: {
            blockBlobId:
              blockFinalizedEvent.finalizedStateMetadata.stateBlobHandle,
          },
        });
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
        blockStateRoots: await this._finalizedStateProxy.stateRoots(),
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
