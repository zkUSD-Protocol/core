import { VaultMap } from '../data/maps/vault-map.js';
import { ZkUsdMap } from '../data/maps/zkusd-map.js';
import { Field } from 'o1js';
import { UInt64, Bool, UInt8 } from 'o1js';
import { IntentMapOperation } from './map-operation.js';

export type SystemParams = {
  validPriceBlockCount: UInt8;
  emergencyStop: Bool;
  collateralRatio: UInt8;
  liquidationBonusRatio: UInt8;
  vaultDebtCeiling: UInt64;
  oraclesHash: Field;
};

export type StateRoots = {
  zkUsdMapRoot: Field;
  vaultMapRoot: Field;
};

export type StateLengths = {
  zkUsdMapLength: Field;
  vaultMapLength: Field;
};

/**
 * Identifies the state of an epoch using its state root.
 */
export type EpochStateCommitment = {
  roots: StateRoots;
  lengths: StateLengths;
};

/**
 * Checks if two epoch state roots are equal.
 */
export function stateRootsEqual(
  roots1: StateRoots,
  roots2: StateRoots
): boolean {
  return (
    roots1.zkUsdMapRoot.equals(roots2.zkUsdMapRoot).toBoolean() &&
    roots1.vaultMapRoot.equals(roots2.vaultMapRoot).toBoolean()
  );
}

export type NextEpochStateCommitment = {
  // resulting state roots and lengths
  nextEpochState: EpochStateCommitment;
  // commitment to a sequence of operations that have occurred since the last epoch
  mapOperationsHash: Field;
};

export class NextEpochStateCandidate {
  nextEpochState: EpochStateCommitment;
  intentOperations: IntentMapOperation[];
  systemParams: SystemParams;
  timestamp: number; // we get this from the sequencer epoch end event

  constructor(
    epochState: EpochStateCommitment,
    intentOperations: IntentMapOperation[],
    systemParams: SystemParams,
    timestamp: number
  ) {
    this.nextEpochState = epochState;
    this.intentOperations = intentOperations;
    this.systemParams = systemParams;
    this.timestamp = timestamp;
  }

  toCommitment(): NextEpochStateCommitment {
    throw new Error('Not implemented');
  }
}

export class IncrementalEpochState {
  nextEpochState: EpochStateCommitment;
  mapOperations: IntentMapOperation[];

  constructor(
    nextEpochState: EpochStateCommitment,
    mapOperations: IntentMapOperation[]
  ) {
    this.nextEpochState = nextEpochState;
    this.mapOperations = mapOperations;
  }

  toCommitment(): NextEpochStateCommitment {
    const mapOperationsHash = IntentMapOperation.rollingHash(
      this.mapOperations
    );
    return {
      nextEpochState: this.nextEpochState,
      mapOperationsHash,
    };
  }
}

export class FullState {
  systemParams: SystemParams;
  vaultMap: VaultMap;
  zkUsdMap: ZkUsdMap;

  constructor(
    systemParams: SystemParams,
    vaultMap: VaultMap,
    zkUsdMap: ZkUsdMap
  ) {
    this.systemParams = systemParams;
    this.vaultMap = vaultMap;
    this.zkUsdMap = zkUsdMap;
  }

  roots(): StateRoots {
    return {
      vaultMapRoot: this.vaultMap.root,
      zkUsdMapRoot: this.zkUsdMap.root,
    };
  }

  // to commitment
  toCommitment(): EpochStateCommitment {
    return {
      roots: {
        vaultMapRoot: this.vaultMap.root,
        zkUsdMapRoot: this.zkUsdMap.root,
      },
      lengths: {
        vaultMapLength: this.vaultMap.length,
        zkUsdMapLength: this.zkUsdMap.length,
      },
    };
  }

  private _applyMapOperation(operation: IntentMapOperation): void {
    // select map
    if (operation.mapType === 'vault') {
      // check operation type
      if (operation.type === 'insert') {
        this.vaultMap.insert(operation.key, operation.value);
      } else if (operation.type === 'update') {
        this.vaultMap.update(operation.key, operation.value);
      }
    } else if (operation.mapType === 'zkusd') {
      // check operation type
      if (operation.type === 'insert') {
        this.zkUsdMap.insert(operation.key, operation.value);
      } else if (operation.type === 'update') {
        this.zkUsdMap.update(operation.key, operation.value);
      }
    }
  }

  applyMapOperations(...operations: IntentMapOperation[]): void {
    for (const operation of operations) {
      this._applyMapOperation(operation);
    }
  }

  clone(): FullState {
    return new FullState(
      this.systemParams,
      this.vaultMap.clone(),
      this.zkUsdMap.clone()
    );
  }
}
