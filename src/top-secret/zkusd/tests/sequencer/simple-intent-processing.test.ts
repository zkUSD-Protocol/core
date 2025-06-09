import { ProvisionalFailureManager, Validator } from '../../validator/validator.js';
import { SequencerMock } from '../../component-mocks/sequencer-mock.js';
import { InMemoryStateProxy } from '../../validator/local-block-state.js';
import { NonProvingStateComputer } from '../../validator/optimistic-state-computer.js';
import { FullState, stateRootsEqual, SystemParams } from '../../validator/block-state.js';
import { Bool, Field, Poseidon, UInt64, UInt8 } from 'o1js';
import { IntentProofProvider } from '../../component-mocks/intent-proofs.js';
import { IntentProofHelper } from '../../types/intent-proof.js';
import { DataAvailMock } from '../../component-mocks/data-avail-mock.js';
import { BlockEndEvent, BlockFinalizedEvent, IntentEvent, StateStoreMetadata } from '../../interfaces/sequencer-interface.js';
import { SubmitIntentParams } from '../../component-mocks/temp-user-interfaces.js';
import assert from 'node:assert'; 
import { describe, it, before } from 'node:test';


type TestSystemState = { 
    state: FullState;
    stateStoreMetadata: StateStoreMetadata;
}

  const defaultSystemParams: SystemParams = {
    validPriceBlockCount: UInt8.from(10),
    emergencyStop: Bool(false),
    collateralRatio: UInt8.from(150),
    liquidationBonusRatio: UInt8.from(100),
    vaultDebtCeiling: UInt64.from(1_000_000e9),
    oraclesHash: Field.from(0),
  };

// genesis test system state
const buildGenesisState = (systemParams: SystemParams) => {

    const state = FullState.newGenesisState(systemParams);
    const stateStoreMetadata = {
        blockBlobId: 'genesisBlockBlobId',
    };
    return { state, stateStoreMetadata };
}

const initSystem = async (systemState: TestSystemState) => {
    const systemParams = defaultSystemParams;

const sequencer = new SequencerMock();
    const { state, stateStoreMetadata } = buildGenesisState(systemParams);
    const dataAvailMock = new DataAvailMock(systemParams);
    await dataAvailMock.initDA(state.roots());
    await dataAvailMock.setFinalizedState(systemState.state, systemState.stateStoreMetadata);

const validator = new Validator(
    sequencer,
    new InMemoryStateProxy(systemState.state, systemState.stateStoreMetadata),
    dataAvailMock,
    new NonProvingStateComputer(),
    new ProvisionalFailureManager()
);
await validator.init();

  return {
    validator,
    sequencer,
    dataAvailMock,
    state,
    stateStoreMetadata
  }
    
}
// I. BOOT
describe('validator simple intents preliminary suite', () => {
  it('should initialize in Genesis state', () => {
    const system = initSystem(buildGenesisState(defaultSystemParams));
    assert.ok(system);
  });

  it('should load preexisting state correctly', () => {
  });
});

// II. USER
describe('validator simple intents on genesis state', () => {
  
  let validator: Validator;
  let sequencer: SequencerMock;
  let dataAvailMock: DataAvailMock;
  let blockStates: FullState[];
  let stateStoreMetadata: StateStoreMetadata;
  let intentProofProvider: IntentProofProvider;
  let intentProofHelper: IntentProofHelper;

  before(async () => {
    const system = await initSystem(buildGenesisState(defaultSystemParams));
    validator = system.validator;
    sequencer = system.sequencer;
    dataAvailMock = system.dataAvailMock;
    blockStates = [system.state];
    stateStoreMetadata = system.stateStoreMetadata;
    intentProofProvider = new IntentProofProvider();
    intentProofHelper = new IntentProofHelper(defaultSystemParams);
    console.log(system.sequencer)
  });

  describe('createVault intent works as expected', () => {
    it('should process createVault intent on happy path', async () => {
      console.log('sequencer', sequencer)
      const intent = await intentProofProvider.createVaultIntent('user1', blockStates[0]);  
      const intentBlobId = await dataAvailMock.storeIntentProof(intent);
      const intentStateRoots = intentProofHelper.stateRoots(intent);
      

      const blockFinalizedEvent: BlockFinalizedEvent = {
        kind: 'block-finalized',
        finalizedStateMetadata: {
          stateRoots: blockStates[0].roots(),
          stateBlobHandle: stateStoreMetadata.blockBlobId,
        },
      };

      console.log('sequenver', sequencer)
      sequencer.pushEvent(blockFinalizedEvent);

      const intentEvent: SubmitIntentParams = {
        intentType: 'create-vault',
        intentBlobId,
        intentStateRoots,
        encryptedNotes: [],
      };
      
      // push new intent event
      sequencer.submitIntent(intentEvent);

      const blockEndEvent: BlockEndEvent = {
        kind: 'block-end',
        timestamp: Date.now(),
        // todo add intents sha checking
        intentsSHA256: 'intentsSHA256',
      };
      sequencer.pushEvent(blockEndEvent);

      await validator.processNextBlock();

      // resulting state roots
      const resultingStateRoots = (await dataAvailMock.getValidatorCandidateState()).state.roots();
      
      const validatedIntents = sequencer.validatedIntents();
      assert(validatedIntents.length === 1);
      assert(stateRootsEqual(validatedIntents[0].partialStateRoots, resultingStateRoots));
      
      const candidateStateOperations = dataAvailMock.candidateStateOperations;
      // print the operation field by field
      // console.log('candidateStateOperations:');
      // for (const op of candidateStateOperations) {
      //   console.log(`  mapType: ${op.mapType}`);
      //   console.log(`  type: ${op.type}`);
      //   console.log(`  key: ${op.key.toString()}`);
      //   console.log(`  value: ${op.value.toString()}`);
      //   console.log('---------------------------------');
      // }
      
      // it contains vaultmap insertion operation
      assert(candidateStateOperations.length === 1);
      assert(candidateStateOperations[0].mapType === 'vault');
      assert(candidateStateOperations[0].type === 'insert');
      
    });

    it('apply candidate state without issues', async () => {
      const resultingStateRoots = (await dataAvailMock.getValidatorCandidateState()).state.roots();
      dataAvailMock.acceptCandidate();
      sequencer.acceptCandidateAndFinalize();
      
      sequencer.pushEvent({
        kind: 'block-end',
        timestamp: Date.now(),
        intentsSHA256: 'intentsSHA256',
      });
      // process block
      await validator.processNextBlock();
      
      const finalizedValidatorState = await validator.finalizedStateRoots();
      assert(stateRootsEqual(finalizedValidatorState, resultingStateRoots));
    });

    it('should sync from da if different state was accepted', async () => {
      

      // compute new state on a different state computer
      const stateComputer = new NonProvingStateComputer();
      const currentFinalizedState = await dataAvailMock.cloneFinalizedState();
      await stateComputer.setState(currentFinalizedState.state);
      
      // sideload intent
      const intent = await intentProofProvider.createVaultIntent('user2', currentFinalizedState.state);
      await stateComputer.step(intent);

      // get and set the candidate state bypassing the validator
      const candidateState = await stateComputer.getStateCandidate();
      const localStateProxy = new InMemoryStateProxy(currentFinalizedState.state, currentFinalizedState.metadata);
      await dataAvailMock.publishBlockUpdate(localStateProxy, candidateState);
      // accept candidate
      dataAvailMock.acceptCandidate();
      // finalize block using sequencer block finalized event
      //
      // gt the finalized state commitment
      const finalizedState = dataAvailMock.cloneFinalizedState();
      sequencer.pushEvent({
        kind: 'block-finalized',
        finalizedStateMetadata: {
          stateRoots: finalizedState.state.roots(),
          stateBlobHandle: finalizedState.metadata.blockBlobId,
        },
      });

      // for test signal the end of the next block
      sequencer.pushEvent({
        kind: 'block-end',
        timestamp: Date.now(),
        intentsSHA256: 'intentsSHA256',
      });
      
      await validator.processNextBlock();

      // check if the validator state was synced
      const validatorState = await validator.finalizedStateRoots();
      // check if sync flag set
      assert(validator.syncedToBlockBlobId === finalizedState.metadata.blockBlobId);
      assert(stateRootsEqual(validatorState, finalizedState.state.roots()));
      dataAvailMock.denyCandidate();

    });

    it('deposit happy path', async () => {
      // sanity to check if validator and da are in sync
      const validatorState = await validator.finalizedStateRoots();
      const dataAvailState = dataAvailMock.cloneFinalizedState();
      assert(stateRootsEqual(validatorState, dataAvailState.state.roots()));

      // finalize the block if we ended on a different state
      // get the current finalized state from da


      const amount = UInt64.from(100);
      const finalizedState = dataAvailMock.cloneFinalizedState();
      sequencer.pushEvent({
        kind: 'block-finalized',
        finalizedStateMetadata: {
          stateRoots: finalizedState.state.roots(),
          stateBlobHandle: finalizedState.metadata.blockBlobId,
        },
      });
      
      // reuse one of created vaults
      const intentProof = await intentProofProvider.depositIntent(finalizedState.state, 'user1', amount);

      // publish intent proof
      const intentBlobId = await dataAvailMock.publishIntentProof(intentProof);

      sequencer.submitIntent({
        intentType: 'deposit',
        intentBlobId,
        intentStateRoots: intentProofHelper.stateRoots(intentProof),
        encryptedNotes: [],
      });

      // signal end of block
      sequencer.pushEvent({
        kind: 'block-end',
        timestamp: Date.now(),
        intentsSHA256: 'intentsSHA256',
      });
      
      await validator.processNextBlock();
      
      // check candidate operations
      const candidateStateOperations = dataAvailMock.candidateStateOperations;
      assert(candidateStateOperations.length === 1);
      assert(candidateStateOperations[0].mapType === 'vault');
      assert(candidateStateOperations[0].type === 'update');
      
    });
  });

  describe('mintZkUsd', () => {
    it('should update zkUsdMap and vaultMap', () => {
    });
  });

// III. VALIDATOR
describe('VALIDATOR', () => {
  it('should process next epoch and halt', () => {
  });
});

});
// Scenarios
//
// For each intent:
// Happy path is tested which means
//   - intent that is valid will be processed by the sequencer
//   - the state will be updated following the intention
//   - only one intent per block
// Common failing scenarios are tested
//   - cannot create vault if already created
//
// The top-level implementation sketch.
//
// I. BOOT
// System is booted in a given state:
// 1. Genesis
// 2. Preexisting operations
// Each intent test has its own descriptions of these both cases
//
// II. USER
// An intent is created and 'pushed' into the system
// Which involves putting proof on DA and sequencing the intent
// using the user interfaces
//
// III. VALIDATOR
// Validator should process the next available epoch and stop.
//
// IV. RESULTS.
// Exception is not thrown or expected (a particular one)
// The state matches the expected state.
// The state tests should check conditions on the maps
//
// --
// transfer:
//   nullifiers added to zkusd map (assertIncluded)
//   commitments for input map include in zkusd map
//   vaultmap unchanged
//
// createVault
//   newVault added to vaultkey key is key: Poseidon.hash([...ownerPublicKey.toFields(), type.value, CreateVaultIntentKey,])
//   value is packed Vault() class
//   zkusdMap is unchanged
//
//  depositCollateral:
//       VaultMap is updated.
//       The vault at vaultKey.key (derived from ownerPublicKey, type, and DepositIntentKey) is updated with the new vaultPack from the DepositIntentProof.
//       ZkUsdMap is unchanged.
//   mintZkUsd:
//       ZkUsdMap is updated:
//           The outputNoteCommitment.commitment from the MintIntentProof is inserted, and its value is set to Note.included().
//        VaultMap is updated:
//
//       The vault at vaultUpdate.vaultAddress is updated with the packed vaultUpdate.vaultState from the MintIntentProof.
//       Both map roots are changed.
//
//   burnZkUsd:
//       ZkUsdMap is updated:
//           For each non-dummy nullifier in nullifiers.nullifiers from the BurnIntentProof, it's asserted that the nullifier is not already included, and then it's set with the value Nullifier.included().
//
//       The outputNoteCommitment.commitment from the BurnIntentProof is inserted, and its value is set to Note.included().
//
//       VaultMap is updated:
//           The vault at vaultUpdate.vaultAddress is updated with the packed vaultUpdate.vaultState from the BurnIntentProof.
//           Both map roots are changed.
//
//   redeemCollateral:
//       VaultMap is updated:
//           The vault at vaultUpdate.vaultAddress is updated with the packed vaultUpdate.vaultState from the RedeemIntentProof.
//
//       ZkUsdMap is unchanged.
//
//   liquidate:
//
//       ZkUsdMap is updated:
//               For each non-dummy nullifier in nullifiers.nullifiers from the LiquidateIntentProof, it's asserted that the nullifier is not already included, and then it's set with the value Nullifier.included().
//               The outputNoteCommitment.commitment from the LiquidateIntentProof is inserted, and its value is set to Note.included().
//
//       VaultMap is updated:
//           The vault at vaultUpdate.vaultAddress is updated with the packed vaultUpdate.vaultState from the LiquidateIntentProof.
//
//       Both map roots are changed.
//   //

