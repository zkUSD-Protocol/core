import { Field } from 'o1js';
import { IndexedMerkleMapBase } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';
import { SerializableMapData, StoredLeaf } from './serializable-indexed-map.js';

export interface PruningRequest {
  keysToProveIncluded: (Field | bigint)[];
  keysToProveNotIncluded: (Field | bigint)[];
}

export class MapPruner {
  /**
   * Create pruned data from a full map
   */
  static createPrunedData<T extends IndexedMerkleMapBase>(
    fullMap: T,
    request: PruningRequest
  ): SerializableMapData {
    const requiredIndices = new Set<number>();
    const requiredSortedLeaves = new Set<number>();

    // For each key we want to prove included, find its leaf and required path
    for (const key of request.keysToProveIncluded) {
      const keyField = Field(key);
      const { self } = fullMap._findLeaf(keyField);

      requiredSortedLeaves.add(self.sortedIndex);
      this.addPathIndices(requiredIndices, self.index, fullMap.height);
    }

    // For each key we want to prove not included, find its low node and required path
    for (const key of request.keysToProveNotIncluded) {
      const keyField = Field(key);
      const { low } = fullMap._findLeaf(keyField);

      requiredSortedLeaves.add(low.sortedIndex);
      this.addPathIndices(requiredIndices, low.index, fullMap.height);
    }

    // Extract the required data
    const fullData = fullMap.data.get();
    return {
      root: fullMap.root.toString(),
      length: fullMap.length.toString(),
      nodes: this.pruneNodes(fullData.nodes, requiredIndices),
      sortedLeaves: this.pruneSortedLeaves(
        fullData.sortedLeaves,
        requiredSortedLeaves
      ),
    };
  }

  /**
   * Estimate pruning efficiency
   */
  static estimatePruningEfficiency<T extends IndexedMerkleMapBase>(
    fullMap: T,
    request: PruningRequest
  ) {
    const fullData = fullMap.data.get();
    const originalSize = this.estimateMapSize(
      fullData.nodes,
      fullData.sortedLeaves
    );

    const prunedData = this.createPrunedData(fullMap, request);
    const prunedSize = this.estimateMapSizeFromSerialized(prunedData);

    return {
      originalSize,
      prunedSize,
      reductionPercentage: ((originalSize - prunedSize) / originalSize) * 100,
    };
  }

  private static addPathIndices(
    requiredIndices: Set<number>,
    leafIndex: number,
    treeHeight: number
  ): void {
    let currentIndex = leafIndex;
    requiredIndices.add(currentIndex);

    for (let level = 0; level < treeHeight - 1; level++) {
      const siblingIndex =
        currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      requiredIndices.add(siblingIndex);
      currentIndex = Math.floor(currentIndex / 2);
      requiredIndices.add(currentIndex);
    }
  }

  private static pruneNodes(
    fullNodes: (bigint | undefined)[][],
    requiredIndices: Set<number>
  ): (string | null)[][] {
    const prunedNodes: (string | null)[][] = [];

    for (let level = 0; level < fullNodes.length; level++) {
      prunedNodes[level] = [];
      for (let i = 0; i < fullNodes[level].length; i++) {
        if (requiredIndices.has(i) && fullNodes[level][i] !== undefined) {
          prunedNodes[level][i] = fullNodes[level][i]!.toString();
        } else {
          prunedNodes[level][i] = null;
        }
      }
    }

    return prunedNodes;
  }

  private static pruneSortedLeaves(
    fullSortedLeaves: any[],
    requiredSortedIndices: Set<number>
  ): StoredLeaf[] {
    return fullSortedLeaves
      .filter((_, index) => requiredSortedIndices.has(index))
      .map((leaf) => ({
        key: leaf.key.toString(),
        value: leaf.value.toString(),
        nextKey: leaf.nextKey.toString(),
        index: leaf.index,
      }));
  }

  private static estimateMapSize(
    nodes: (bigint | undefined)[][],
    sortedLeaves: any[]
  ): number {
    let size = 0;
    for (const level of nodes) {
      for (const node of level) {
        if (node !== undefined) {
          size += 32;
        }
      }
    }
    size += sortedLeaves.length * (32 * 4);
    return size;
  }

  private static estimateMapSizeFromSerialized(
    data: SerializableMapData
  ): number {
    let size = 0;
    for (const level of data.nodes) {
      for (const node of level) {
        if (node !== null) {
          size += 32;
        }
      }
    }
    size += data.sortedLeaves.length * (32 * 4);
    return size;
  }
}
