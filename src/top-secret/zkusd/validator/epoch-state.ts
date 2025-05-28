import { VaultMap } from "../data/maps/vault-map.js";
import { ZkUsdMap } from "../data/maps/zkusd-map.js";
import { Field } from "o1js";
import { UInt64, Bool, UInt8 } from "o1js";
import { IntentMapOperation } from "./map-operation.js";

export type SystemParams = {
    validPriceBlockCount: UInt8,
    emergencyStop: Bool,
    collateralRatio: UInt8,
    liquidationBonusRatio: UInt8,
    vaultDebtCeiling: UInt64,
    oraclesHash: Field,
}

/**
 * Identifies the state of an epoch using its state root.
 */
export type EpochStateRoots = {
  zkUsdMapRoot: Field;
  vaultMapRoot: Field;
};

/**
 * Checks if two epoch state roots are equal.
 */
export function stateRootsEqual(root1: EpochStateRoots, root2: EpochStateRoots): boolean {
    return root1.zkUsdMapRoot.equals(root2.zkUsdMapRoot).toBoolean() && root1.vaultMapRoot.equals(root2.vaultMapRoot).toBoolean();
}

export type IncrementalEpochStateCommitment = {
    // resulting state roots
    nextEpochStateRoots: EpochStateRoots;
    // commitment to a sequence of operations that have occurred since the last epoch
    mapOperationsHash: Field;
}

export class IncrementalEpochState {
    nextEpochStateRoots: EpochStateRoots;
    mapOperations: IntentMapOperation[];

    constructor(
        epochStateRoots: EpochStateRoots,
        mapOperations: IntentMapOperation[]
    ) {
        this.nextEpochStateRoots = epochStateRoots;
        this.mapOperations = mapOperations;
    }

    toCommitment(): IncrementalEpochStateCommitment {
        throw new Error('Not implemented');
    }

}

export class FullEpochState {
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

  // to commitment
  roots(): EpochStateRoots {
    return { 
        vaultMapRoot: this.vaultMap.root,
        zkUsdMapRoot: this.zkUsdMap.root
    };
}


private _applyMapOperation(operation: IntentMapOperation): void {
    // select map 
    if(operation.mapType  === 'vault') {
        // check operation type
        if(operation.type === 'insert') {
            this.vaultMap.insert(operation.key, operation.value);
        }
        else if(operation.type === 'update') {
            this.vaultMap.update(operation.key, operation.value);
        }
    }
    else if(operation.mapType === 'zkusd') {
        // check operation type
        if(operation.type === 'insert') {
            this.zkUsdMap.insert(operation.key, operation.value);
        }
        else if(operation.type === 'update') {
            this.zkUsdMap.update(operation.key, operation.value);
        }
    }
}

applyMapOperations(...operations: IntentMapOperation[]): void {
    for(const operation of operations) {
        this._applyMapOperation(operation);
    }
}

clone(): FullEpochState {
    return new FullEpochState(this.systemParams, this.vaultMap.clone(), this.zkUsdMap.clone());
}
}

    