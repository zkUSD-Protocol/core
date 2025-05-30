import { Experimental, Field } from 'o1js';
import { IndexedMerkleMapBase } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';

const { IndexedMerkleMap } = Experimental;

export interface SerializableMapData {
  root: string;
  length: string;
  nodes: (string | null)[][]; // Changed from bigint to string
  sortedLeaves: StoredLeaf[];
}

export interface StoredLeaf {
  readonly value: string; // Changed from bigint to string
  readonly key: string; // Changed from bigint to string
  readonly nextKey: string; // Changed from bigint to string
  readonly index: number;
}

export function createSerializableIndexedMap(height: number) {
  const BaseMap = IndexedMerkleMap(height);

  return class SerializableIndexedMap extends BaseMap {
    /**
     * Serialize the map to JSON-compatible format
     */
    serialize(): SerializableMapData {
      const data = this.data.get();
      return {
        root: this.root.toString(),
        length: this.length.toString(),
        nodes: data.nodes.map((level) =>
          level.map((node) => (node !== undefined ? node.toString() : null))
        ),
        sortedLeaves: data.sortedLeaves.map((leaf) => ({
          key: leaf.key.toString(),
          value: leaf.value.toString(),
          nextKey: leaf.nextKey.toString(),
          index: leaf.index,
        })),
      };
    }

    /**
     * Create a map from serialized data
     */
    static fromSerialized(data: SerializableMapData): SerializableIndexedMap {
      if (!SerializableIndexedMap.verifyIntegrity(data)) {
        throw new Error('Invalid serialized data');
      }

      const map = new this();
      map.root = Field(data.root);
      map.length = Field(data.length);
      map.data.updateAsProver(() => ({
        nodes: data.nodes.map((level) =>
          level.map((node) => (node !== null ? BigInt(node) : undefined))
        ),
        sortedLeaves: data.sortedLeaves.map((leaf) => ({
          key: BigInt(leaf.key),
          value: BigInt(leaf.value),
          nextKey: BigInt(leaf.nextKey),
          index: leaf.index,
        })),
      }));

      return map;
    }

    /**
     * Verify the integrity of serialized data
     */
    static verifyIntegrity(data: SerializableMapData): boolean {
      try {
        if (!data.root || !data.length || !data.nodes || !data.sortedLeaves) {
          return false;
        }

        // Validate sorted leaves are properly ordered
        const leaves = data.sortedLeaves;
        for (let i = 1; i < leaves.length; i++) {
          if (BigInt(leaves[i].key) <= BigInt(leaves[i - 1].key)) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    }
  };
}
