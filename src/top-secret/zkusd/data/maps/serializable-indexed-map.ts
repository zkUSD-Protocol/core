import { Experimental, Field } from 'o1js';
import { IndexedMerkleMapBase } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';

const { IndexedMerkleMap } = Experimental;

export interface SerializableMapData {
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
        nodes: data.nodes,
        sortedLeaves: data.sortedLeaves,
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
        nodes: data.nodes,
        sortedLeaves: data.sortedLeaves,
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
          if (leaves[i].key <= leaves[i - 1].key) {
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
