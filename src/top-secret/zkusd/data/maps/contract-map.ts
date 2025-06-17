import {
  createSerializableIndexedMap,
  SerializableMapData,
} from './serializable-indexed-map.js';
import { MapPruner, PruningRequest } from './map-pruner.js';
import { PrunedMapBase } from './pruned-map-base.js';

const CONTRACT_MAP_HEIGHT = 20; // 1,048,576

// Create base serializable map
const ContractMapBase = createSerializableIndexedMap(CONTRACT_MAP_HEIGHT);

export class ContractMap extends ContractMapBase {
  /**
   * Create a pruned version of this map
   */
  createPruned(request: PruningRequest): PrunedContractMap {
    const prunedData = MapPruner.createPrunedData(this, request);
    return new PrunedContractMap(prunedData);
  }

  /**
   * Estimate pruning efficiency
   */
  estimatePruningEfficiency(request: PruningRequest) {
    return MapPruner.estimatePruningEfficiency(this, request);
  }

  /**
   * Create a ContractMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): ContractMap {
    return super.fromSerialized(data) as ContractMap;
  }
}

export class PrunedContractMap extends PrunedMapBase {
  constructor(data: SerializableMapData) {
    super(new ContractMapBase(), data);
  }

  /**
   * Create a PrunedContractMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): PrunedContractMap {
    if (!ContractMapBase.verifyIntegrity(data)) {
      throw new Error('Invalid serialized data for PrunedContractMap');
    }
    return new PrunedContractMap(data);
  }
}
