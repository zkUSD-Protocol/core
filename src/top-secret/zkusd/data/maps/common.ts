import { Bool, Experimental, Field } from 'o1js';
import { IndexedMerkleMapBase } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';

export interface PrunedMapData {
  root: string;
  length: string;
  nodes: (bigint | undefined)[][];
  sortedLeaves: StoredLeaf[];
}

export interface StoredLeaf {
  readonly value: bigint;
  readonly key: bigint;
  readonly nextKey: bigint;
  readonly index: number;
}

export class PrunedMapBase {
  protected constructor(
    protected baseMap: IndexedMerkleMapBase,
    prunedData: PrunedMapData
  ) {
    this.baseMap.root = Field(prunedData.root);
    this.baseMap.length = Field(prunedData.length);
    this.baseMap.data.updateAsProver(() => ({
      nodes: prunedData.nodes,
      sortedLeaves: prunedData.sortedLeaves,
    }));
  }

  get root() {
    return this.baseMap.root;
  }
  get length() {
    return this.baseMap.length;
  }
  get data() {
    return this.baseMap.data;
  }
  get height() {
    return this.baseMap.height;
  }

  assertIncluded(key: Field | bigint, message?: string): void {
    this.baseMap.assertIncluded(key, message);
  }

  assertNotIncluded(key: Field | bigint, message?: string): void {
    this.baseMap.assertNotIncluded(key, message);
  }

  isIncluded(key: Field | bigint): Bool {
    return this.baseMap.isIncluded(key);
  }

  get(key: Field | bigint): Field {
    return this.baseMap.get(key);
  }

  getOption(key: Field | bigint) {
    return this.baseMap.getOption(key);
  }

  // Disable mutation methods
  insert(): never {
    throw new Error('Cannot insert into a pruned map');
  }
  update(): never {
    throw new Error('Cannot update a pruned map');
  }
  set(): never {
    throw new Error('Cannot set in a pruned map');
  }
  setIf(): never {
    throw new Error('Cannot setIf in a pruned map');
  }
}
