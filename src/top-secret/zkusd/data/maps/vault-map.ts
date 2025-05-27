import { Experimental } from 'o1js';
import { PrunedMapBase, PrunedMapData } from './common';

const VAULT_MAP_HEIGHT = 20; // 1,048,576

const { IndexedMerkleMap } = Experimental;

export class VaultMap extends IndexedMerkleMap(VAULT_MAP_HEIGHT) {}

export class PrunedVaultMap extends PrunedMapBase {
  constructor(prunedData: PrunedMapData) {
    super(new VaultMap(), prunedData);
  }
}
