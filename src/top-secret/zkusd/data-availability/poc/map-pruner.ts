import { Field } from 'o1js';
import { ZkUsdMap, PrunedZkUsdMap } from '../../data/maps/zkusd-map.js';
import { PrunedMapData, StoredLeaf } from '../../data/maps/common.js';

export interface PruningRequest {
  keysToProveIncluded: (Field | bigint)[];
  keysToProveNotIncluded: (Field | bigint)[];
}

export class MapPruner {
  /**
   * Creates a pruned subset of the full map that contains only the data needed
   * to prove inclusion/non-inclusion of the specified keys.
   */
  static createPrunedMap(
    fullMap: ZkUsdMap,
    request: PruningRequest
  ): PrunedZkUsdMap {
    const requiredIndices = new Set<number>();
    const requiredSortedLeaves = new Set<number>();

    // For each key we want to prove included, find its leaf and required path
    for (const key of request.keysToProveIncluded) {
      const keyField = Field(key);
      const { self } = fullMap._findLeaf(keyField);

      // Add this leaf's sorted index
      requiredSortedLeaves.add(self.sortedIndex);

      // Add the tree path indices for this leaf
      const leafIndex = self.index;
      this.addPathIndices(requiredIndices, leafIndex, fullMap.height);
    }

    // For each key we want to prove not included, find its low node and required path
    for (const key of request.keysToProveNotIncluded) {
      const keyField = Field(key);
      const { low } = fullMap._findLeaf(keyField);

      // Add the low node's sorted index
      requiredSortedLeaves.add(low.sortedIndex);

      // Add the tree path indices for the low node
      const lowIndex = low.index;
      this.addPathIndices(requiredIndices, lowIndex, fullMap.height);
    }

    // Extract the required data
    const fullData = fullMap.data.get();
    const prunedData: PrunedMapData = {
      root: fullMap.root.toString(),
      length: fullMap.length.toString(),
      nodes: this.pruneNodes(fullData.nodes, requiredIndices),
      sortedLeaves: this.pruneSortedLeaves(
        fullData.sortedLeaves,
        requiredSortedLeaves
      ),
    };

    return new PrunedZkUsdMap(prunedData);
  }

  /**
   * Adds all node indices required for the Merkle path from leaf to root
   */
  private static addPathIndices(
    requiredIndices: Set<number>,
    leafIndex: number,
    treeHeight: number
  ): void {
    let currentIndex = leafIndex;

    // Add the leaf itself
    requiredIndices.add(currentIndex);

    // Add all sibling nodes on the path to root
    for (let level = 0; level < treeHeight - 1; level++) {
      // Add the sibling
      const siblingIndex =
        currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      requiredIndices.add(siblingIndex);

      // Move to parent
      currentIndex = Math.floor(currentIndex / 2);
      requiredIndices.add(currentIndex);
    }
  }

  /**
   * Creates a sparse nodes array with only the required indices populated
   */
  private static pruneNodes(
    fullNodes: (bigint | undefined)[][],
    requiredIndices: Set<number>
  ): (bigint | undefined)[][] {
    const prunedNodes: (bigint | undefined)[][] = [];

    for (let level = 0; level < fullNodes.length; level++) {
      prunedNodes[level] = [];

      // Copy only the required nodes for this level
      for (let i = 0; i < fullNodes[level].length; i++) {
        if (requiredIndices.has(i)) {
          prunedNodes[level][i] = fullNodes[level][i];
        }
        // Leave undefined for non-required indices
      }
    }

    return prunedNodes;
  }

  /**
   * Creates a filtered sortedLeaves array with only the required leaves
   */
  private static pruneSortedLeaves(
    fullSortedLeaves: StoredLeaf[],
    requiredSortedIndices: Set<number>
  ): StoredLeaf[] {
    return fullSortedLeaves.filter((_, index) =>
      requiredSortedIndices.has(index)
    );
  }

  /**
   * Estimates the size reduction achieved by pruning
   */
  static estimatePruningEfficiency(
    fullMap: ZkUsdMap,
    request: PruningRequest
  ): {
    originalSize: number;
    prunedSize: number;
    reductionPercentage: number;
  } {
    const fullData = fullMap.data.get();
    const originalSize = this.estimateMapSize(
      fullData.nodes,
      fullData.sortedLeaves
    );

    const prunedMap = this.createPrunedMap(fullMap, request);
    const prunedData = prunedMap.data.get();
    const prunedSize = this.estimateMapSize(
      prunedData.nodes,
      prunedData.sortedLeaves
    );

    return {
      originalSize,
      prunedSize,
      reductionPercentage: ((originalSize - prunedSize) / originalSize) * 100,
    };
  }

  private static estimateMapSize(
    nodes: (bigint | undefined)[][],
    sortedLeaves: StoredLeaf[]
  ): number {
    let size = 0;

    // Count non-undefined nodes
    for (const level of nodes) {
      for (const node of level) {
        if (node !== undefined) {
          size += 32; // 32 bytes per bigint
        }
      }
    }

    // Count sorted leaves
    size += sortedLeaves.length * (32 * 4); // 4 bigints per leaf

    return size;
  }
}
