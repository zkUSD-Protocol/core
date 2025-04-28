import { Field, MerkleTree, MerkleWitness } from 'o1js';
import { ZkusdProtocolUpdateSpec } from '../update/input.js';

/**
 * Height of the Merkle tree for passed proposals - resolutions.
 * Supports up to 2^19 slots (524288) for storing update hashes.
 */
const ZKUSD_GOV_UPDATE_TREE_HEIGHT = 20;

/**
 * Merkle Witness class used to prove membership of updates in the
 * ZKUSD council resolution merkle tree.
 */
class ZkusdGovUpdateWitness extends MerkleWitness(
  ZKUSD_GOV_UPDATE_TREE_HEIGHT
) {
  static HEIGHT = ZKUSD_GOV_UPDATE_TREE_HEIGHT;
}

/**
 * A Merkle tree that holds resolution update hashes.
 *
 * - Uses ZkusdGovUpdateWitness for Merkle inclusion proofs.
 * - Can locate the next empty leaf slot for insertion.
 * - Can generate a witness for a known or new update hash.
 */
export class ResolutionTree extends MerkleTree {
  /** Height of the Merkle tree, inherited from the witness type. */
  static readonly HEIGHT = ZkusdGovUpdateWitness.HEIGHT;

  /** Merkle witness class used for proof generation. */
  static readonly Witness = ZkusdGovUpdateWitness;

  /**
   * Initializes a new ResolutionTree with a fixed height.
   */
  constructor() {
    super(ResolutionTree.HEIGHT);
  }

  /**
   * Finds the first empty slot (leaf) in the tree.
   *
   * @returns The index of the first leaf whose value is zero.
   * @throws If no empty leaf is found.
   */
  public getNextEmptyIndex(): bigint {
    for (let i = 0n; i < this.leafCount; i++) {
      if (this.getLeaf(i).toBigInt() === 0n) {
        return i;
      }
    }
    throw new Error('Could not find an empty Resolution Index.');
  }

  /**
   * Finds a witness for a given update hash.
   *
   * - If the hash is already present in the tree, returns its witness and marks it as existing.
   * - If not found, returns a witness for the next empty slot.
   *
   * @param updateHash - The Field hash of the update.
   * @returns An object containing the witness and a flag indicating if the slot is empty.
   * @throws If the tree is full and the updateHash was not found.
   */
  public getUpdateWitness(updateHash: Field): {
    witness: InstanceType<typeof ResolutionTree.Witness>;
    empty: boolean;
  } {
    for (let i = 0n; i < this.leafCount; i++) {
      const hash = this.getLeaf(i);

      if (hash.equals(updateHash)) {
        return {
          witness: new ResolutionTree.Witness(this.getWitness(i)),
          empty: false,
        };
      }

      if (hash.toBigInt() === 0n) {
        return {
          witness: new ResolutionTree.Witness(this.getWitness(i)),
          empty: true,
        };
      }
    }

    throw new Error('Resolution tree is full and the update was not found.');
  }

  /**
   * Provides a witness for a specific index in the tree.
   *
   * @param index - The index where the update hash should be inserted.
   */
  public getWitnessWrapped(
    index: bigint | number | ZkusdProtocolUpdateSpec
  ): InstanceType<typeof ResolutionTree.Witness> { 
    if (index instanceof ZkusdProtocolUpdateSpec) {
      return this.getWitnessWrapped(index.govResolutionIndex.toBigint());
    }
    return new ResolutionTree.Witness(this.getWitness(BigInt(index)));
  }
}

/**
 * Namespaced access to the witness type for typing convenience.
 */
export namespace ResolutionTree {
  export type Witness = ZkusdGovUpdateWitness;
}
