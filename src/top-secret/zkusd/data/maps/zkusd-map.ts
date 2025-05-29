import {
  createSerializableIndexedMap,
  SerializableMapData,
} from './serializable-indexed-map.js';
import { MapPruner, PruningRequest } from './map-pruner.js';
import { PrunedMapBase } from './pruned-map-base.js';

const ZKUSD_MAP_HEIGHT = 52; // 4,503,599,627,370,496 - 4.5 quadrillion

// Create base serializable map
const ZkUsdMapBase = createSerializableIndexedMap(ZKUSD_MAP_HEIGHT);

export class ZkUsdMap extends ZkUsdMapBase {
  /**
   * Create a pruned version of this map
   */
  createPruned(request: PruningRequest): PrunedZkUsdMap {
    const prunedData = MapPruner.createPrunedData(this, request);
    return new PrunedZkUsdMap(prunedData);
  }

  /**
   * Estimate pruning efficiency
   */
  estimatePruningEfficiency(request: PruningRequest) {
    return MapPruner.estimatePruningEfficiency(this, request);
  }

  /**
   * Create a ZkUsdMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): ZkUsdMap {
    return super.fromSerialized(data) as ZkUsdMap;
  }
}

export class PrunedZkUsdMap extends PrunedMapBase {
  constructor(data: SerializableMapData) {
    super(new ZkUsdMapBase(), data);
  }

  /**
   * Create a PrunedZkUsdMap from serialized data
   */
  static fromSerialized(data: SerializableMapData): PrunedZkUsdMap {
    if (!ZkUsdMapBase.verifyIntegrity(data)) {
      throw new Error('Invalid serialized data for PrunedZkUsdMap');
    }
    return new PrunedZkUsdMap(data);
  }
}
