import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { VaultMap, PrunedVaultMap } from '../../data/maps/vault-map.js';
import { ZkUsdMap, PrunedZkUsdMap } from '../../data/maps/zkusd-map.js';
import { Bool, Field, UInt64, UInt8 } from 'o1js';
import { ValidatorDAClient } from './validator-client.js';
import {
  FullState,
  NextStateCandidate,
  stateRootsEqual,
  SystemParams,
} from '../../validator/block-state.js';
import {
  InMemoryStateProxy,
  LocalStateProxy,
} from '../../validator/local-block-state.js';
import { StateCommitment } from '../../validator/sequencer-interface.js';
import { IntentMapOperation } from '../../validator/map-operation.js';
import { StateRoots } from '../../validator/block-state.js';
import { MapType, OperationType } from '../types/types.js';

function generateRandomVaultMapOperation(): IntentMapOperation {
  const mapType = MapType.VAULT;
  const type = OperationType.INSERT;
  const key = Field.random();
  const value = Field.random();
  return new IntentMapOperation(mapType, type, key, value);
}

function generateRandomZkUsdMapOperation(): IntentMapOperation {
  const mapType = MapType.ZKUSD;
  const type = OperationType.INSERT;
  const key = Field.random();
  const value = Field.from(1);
  return new IntentMapOperation(mapType, type, key, value);
}

function generateRandomIntentMapOperation(): IntentMapOperation {
  const mapType = [MapType.VAULT, MapType.ZKUSD][Math.floor(Math.random() * 2)];
  if (mapType === MapType.VAULT) {
    return generateRandomVaultMapOperation();
  } else {
    return generateRandomZkUsdMapOperation();
  }
}

async function processLocalIntentsForNextBlock(
  localStateProxy: LocalStateProxy,
  numberOfIntents: number = 10
): Promise<{
  nextStateValidatedIntentOperations: IntentMapOperation[];
  nextStateRoots: StateRoots;
}> {
  const tempState = (await localStateProxy.useState()).clone();
  const intentMapOperations: IntentMapOperation[] = [];
  for (let i = 0; i < numberOfIntents; i++) {
    const intentMapOperation = generateRandomIntentMapOperation();
    intentMapOperations.push(intentMapOperation);
  }
  tempState.applyMapOperations(...intentMapOperations);
  const nextStateRoots: StateRoots = tempState.roots();
  return {
    nextStateValidatedIntentOperations: intentMapOperations,
    nextStateRoots: nextStateRoots,
  };
}

describe('ZkUsd DA Tests', () => {
  // Create and populate maps
  const systemParams: SystemParams = {
    validPriceBlockCount: UInt8.from(10),
    emergencyStop: Bool(false),
    collateralRatio: UInt8.from(150),
    liquidationBonusRatio: UInt8.from(100),
    vaultDebtCeiling: UInt64.from(1_000_000e9),
    oraclesHash: Field.from(0),
  };
  let genesisRoots: StateRoots;
  const genesisState = FullState.newGenesisState(systemParams);
  let localStateProxy: LocalStateProxy = new InMemoryStateProxy(genesisState, {
    blockBlobId: '',
    checkpointBlobId: '',
  });
  let client: ValidatorDAClient;
  let finalizedState: StateCommitment;

  before(async () => {
    //create a local client for testing
    client = await ValidatorDAClient.withLocal({
      baseDir:
        './src/top-secret/zkusd/data-availability/local-data-availability',
      checkpointInterval: 10, // Create checkpoints every 10 blocks for testing
    });

    await client.storageProvider.cleanup!();

    // client = await ValidatorDAClient.withWalrus({
    //   network: 'testnet',
    //   defaultEpochs: 1,
    //   checkpointInterval: 10,
    //   timeout: 60_000,
    // });
    // await client.storageProvider.cleanup!();

    genesisRoots = {
      vaultMapRoot: new VaultMap().root,
      zkUsdMapRoot: new ZkUsdMap().root,
    };
  });

  it('should initialize the data availability', async () => {
    const blobIds = await client.initDA(genesisRoots);

    finalizedState = {
      stateRoots: await localStateProxy.stateRoots(),
      stateBlobHandle: blobIds.blockBlobId,
    };

    localStateProxy = new InMemoryStateProxy(genesisState, {
      blockBlobId: blobIds.blockBlobId,
      checkpointBlobId: blobIds.checkpointBlobId,
    });

    assert.ok(blobIds.blockBlobId);
  });

  it('should publish an block update', async () => {
    const { nextStateValidatedIntentOperations, nextStateRoots } =
      await processLocalIntentsForNextBlock(localStateProxy);

    const blobIds = await client.publishBlockUpdate(
      localStateProxy,
      new NextStateCandidate(nextStateRoots, nextStateValidatedIntentOperations)
    );

    //This is the blockFinalizedEventState
    finalizedState = {
      stateRoots: nextStateRoots,
      stateBlobHandle: blobIds.blockBlobId,
    };

    //Now we need to update the localFinalizedState to the blockFinalizedEventState

    assert.ok(blobIds.blockBlobId);
  });

  it('should sync the local state to the target metadata', async () => {
    await client.syncViaBlockBlob({
      localStateProxy,
      blockBlobId: finalizedState.stateBlobHandle,
    });

    console.log(finalizedState);

    const localState = await localStateProxy.useState();
    assert.ok(
      stateRootsEqual(localState.roots(), finalizedState.stateRoots),
      'Local state roots do not match finalized state roots after initial sync'
    );
  });

  it('should publish a checkpoint after 10 blocks', async () => {
    for (let i = 0; i < 10; i++) {
      const { nextStateValidatedIntentOperations, nextStateRoots } =
        await processLocalIntentsForNextBlock(localStateProxy);

      const blobIds = await client.publishBlockUpdate(
        localStateProxy,
        new NextStateCandidate(
          nextStateRoots,
          nextStateValidatedIntentOperations
        )
      );

      finalizedState = {
        stateRoots: nextStateRoots,
        stateBlobHandle: blobIds.blockBlobId,
      };

      await client.syncViaBlockBlob({
        localStateProxy,
        blockBlobId: finalizedState.stateBlobHandle,
      });

      const localState = await localStateProxy.useState();

      assert.ok(
        stateRootsEqual(localState.roots(), finalizedState.stateRoots),
        `Local state roots do not match finalized state roots after ${i} blocks`
      );
    }
  });

  it('should sync the local state to the target metadata after a checkpoint', async () => {
    //First we reset our local state to the genesis state
    const freshState = FullState.newGenesisState(systemParams);
    const freshStateStoreMetadata = await localStateProxy.setState({
      finalizedState: freshState,
      finalizedStateStoreMetadata: {
        blockBlobId: finalizedState.stateBlobHandle,
      },
    });

    await client.syncViaBlockBlob({
      localStateProxy,
      blockBlobId: finalizedState.stateBlobHandle,
    });

    const localState = await localStateProxy.useState();

    assert.ok(
      stateRootsEqual(localState.roots(), finalizedState.stateRoots),
      'Local state roots do not match finalized state roots after sync'
    );
  });
});
