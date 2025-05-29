import {
  createSerializableIndexedMap,
  SerializableMapData,
} from './serializable-indexed-map.js';
import { MapPruner, PruningRequest } from './map-pruner.js';
import { PrunedMapBase } from './pruned-map-base.js';

const VAULT_MAP_HEIGHT = 20; // 1,048,576

// Create base serializable map
const VaultMapBase = createSerializableIndexedMap(VAULT_MAP_HEIGHT);

export class VaultMap extends VaultMapBase {
  /**
   * Create a pruned version of this map
   */
  createPruned(request: PruningRequest): PrunedVaultMap {
    const prunedData = MapPruner.createPrunedData(this, request);
    return new PrunedVaultMap(prunedData);
  }

  /**
   * Estimate pruning efficiency
   */
  estimatePruningEfficiency(request: PruningRequest) {
    return MapPruner.estimatePruningEfficiency(this, request);
  }

  /**
   * Create a VaultMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): VaultMap {
    return super.fromSerialized(data) as VaultMap;
  }
}

export class PrunedVaultMap extends PrunedMapBase {
  constructor(data: SerializableMapData) {
    super(new VaultMapBase(), data);
  }

  /**
   * Create a PrunedVaultMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): PrunedVaultMap {
    if (!VaultMapBase.verifyIntegrity(data)) {
      throw new Error('Invalid serialized data for PrunedVaultMap');
    }
    return new PrunedVaultMap(data);
  }
}
