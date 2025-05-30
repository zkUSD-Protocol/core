import { Bool, Field } from 'o1js';
import { IndexedMerkleMapBase } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';
import { SerializableMapData } from './serializable-indexed-map.js';

export class PrunedMapBase {
  protected constructor(
    protected baseMap: IndexedMerkleMapBase,
    data: SerializableMapData
  ) {
    this.baseMap.root = Field(data.root);
    this.baseMap.length = Field(data.length);
    this.baseMap.data.updateAsProver(() => ({
      // Convert string nodes back to bigint | undefined
      nodes: data.nodes.map((level) =>
        level.map((node) => (node !== null ? BigInt(node) : undefined))
      ),
      // Convert string sortedLeaves back to bigint format
      sortedLeaves: data.sortedLeaves.map((leaf) => ({
        key: BigInt(leaf.key),
        value: BigInt(leaf.value),
        nextKey: BigInt(leaf.nextKey),
        index: leaf.index,
      })),
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

  /**
   * Serialize the pruned map
   */
  serialize(): SerializableMapData {
    const data = this.data.get();
    return {
      root: this.root.toString(),
      length: this.length.toString(),
      // Convert bigint nodes to string format
      nodes: data.nodes.map((level) =>
        level.map((node) => (node !== undefined ? node.toString() : null))
      ),
      // Convert bigint sortedLeaves to string format
      sortedLeaves: data.sortedLeaves.map((leaf) => ({
        key: leaf.key.toString(),
        value: leaf.value.toString(),
        nextKey: leaf.nextKey.toString(),
        index: leaf.index,
      })),
    };
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
