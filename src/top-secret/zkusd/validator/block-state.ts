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
 * Identifies the state of an block using its state root.
 */
export type BlockStateCommitment = {
  roots: StateRoots;
  lengths: StateLengths;
};

/**
 * Checks if two block state roots are equal.
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

export type NextBlockStateCommitment = {
  // resulting state roots and lengths
  nextBlockState: BlockStateCommitment;
  // commitment to a sequence of operations that have occurred since the last block
  intentOperationsHash: Field;
};

export class NextStateCandidate {
  nextBlockState: BlockStateCommitment;
  intentOperations: IntentMapOperation[];
  systemParams: SystemParams; // not used for now?
  timestamp: number; // we get this from the sequencer block end event

  constructor(
    blockState: BlockStateCommitment,
    intentOperations: IntentMapOperation[],
    systemParams: SystemParams,
    timestamp: number
  ) {
    this.nextBlockState = blockState;
    this.intentOperations = intentOperations;
    this.systemParams = systemParams;
    this.timestamp = timestamp;
  }
  toCommitment(): NextBlockStateCommitment {
    const intentOperationsHash = IntentMapOperation.rollingHash(
      this.intentOperations
    );
    return {
      nextBlockState: this.nextBlockState,
      intentOperationsHash,
    };
  }

  stateRoots(): StateRoots {
    throw new Error("not implemented");
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

  static newGenesisState(systemParams: SystemParams): FullState {
    const vaultMap = new VaultMap();
    const zkUsdMap = new ZkUsdMap();
    return new FullState(systemParams, vaultMap, zkUsdMap);
  }

  roots(): StateRoots {
    return {
      vaultMapRoot: this.vaultMap.root,
      zkUsdMapRoot: this.zkUsdMap.root,
    };
  }

  // to commitment
  toCommitment(): BlockStateCommitment {
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
      this.vaultMap.clone() as VaultMap,
      this.zkUsdMap.clone() as ZkUsdMap
    );
  }
}
