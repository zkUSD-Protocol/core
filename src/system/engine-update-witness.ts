import { Field, MerkleTree, MerkleWitness, Provable, Struct } from 'o1js';
import { ZkusdProtocolUpdateProof } from './update-proof.js';

// NOTE: Tree height = 16 → 2^(16 - 1) = 32,768 leaves
const ZKUSD_UPDATE_TREE_HEIGHT = 16; // Allows 32,768 updates

export class ZkusdResolutionWitness extends MerkleWitness(ZKUSD_UPDATE_TREE_HEIGHT) {}

export class ZkusdEngineUpdateWitness extends Struct({
  previousWitness: ZkusdResolutionWitness,
  currentWitness: ZkusdResolutionWitness,
}) {}

/**
 * Creates a Merkle tree of resolution nullifiers.
 * All leaves before `nextUpdateIndex` are set to 1 (used), the rest are 0 (unused).
 */
export function createZkusdResolutionNullifierTree(nextUpdateIndex: number): MerkleTree {
  const tree = new MerkleTree(ZKUSD_UPDATE_TREE_HEIGHT);
  const maxLeaves = 2 ** (ZKUSD_UPDATE_TREE_HEIGHT - 1);

  for (let i = 0; i < nextUpdateIndex && i < maxLeaves; i++) {
    tree.setLeaf(BigInt(i), Field(1));
  }

  return tree;
}

/**
 * Returns the initial nullifier root where only the first update (index 0) is marked as used.
 */
export function getInitialZkusdResolutionNullifierTreeRoot(): Field {
  return createZkusdResolutionNullifierTree(1).getRoot();
}

/**
 * Ensures the provided update proof has not been used, marks it as used, and returns the updated Merkle root.
 * Enforces strict sequential usage (e.g., index 2 only after index 1 is used).
 */
export function applyResolutionProof(
  resolutionProof: ZkusdProtocolUpdateProof,
  resolutionWitness: ZkusdEngineUpdateWitness,
  currentRoot: Field
): Field {
  const previousIndex = resolutionWitness.previousWitness.calculateIndex();
  const currentIndex = resolutionWitness.currentWitness.calculateIndex();

  const maxValidPreviousIndex = Field.from(2 ** (ZKUSD_UPDATE_TREE_HEIGHT - 1) - 2);
  previousIndex.assertLessThanOrEqual(maxValidPreviousIndex);

  currentIndex.assertEquals(previousIndex.add(1));

  resolutionProof.publicInput.govResolutionIndex.value.assertEquals(currentIndex);

  Provable.log('check if current root matches previousIndexWitness');
  resolutionWitness.previousWitness.calculateRoot(Field(1)).assertEquals(currentRoot);
  Provable.log('current root does match previousIndexWitness, check the current');
  resolutionWitness.currentWitness.calculateRoot(Field(0)).assertEquals(currentRoot);
  Provable.log('current root does match currentWitness, update the tree');

  return resolutionWitness.currentWitness.calculateRoot(Field(1));
}

/**
 * Finds the next unused resolution index based solely on the Merkle root,
 * assuming the tree has a contiguous sequence of 1s starting at index 0.
 */
export function findNextResolutionIndexFromRoot(root: Field): number {
  const maxLeaves = 2 ** (ZKUSD_UPDATE_TREE_HEIGHT - 1);
  let low = 1;
  let high = maxLeaves - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const testTree = createZkusdResolutionNullifierTree(mid);
    const testRoot = testTree.getRoot();

    if (testRoot.equals(root)) {
      return mid;
    } else if (testRoot.lessThan(root)) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  throw new Error('Unable to resolve Merkle root to a valid next resolution index.');
}

/**
 * Generates the next valid ZkusdEngineUpdateWitness using only the current Merkle root.
 */
export function generateNextUpdateWitnessFromRoot(root: Field): ZkusdEngineUpdateWitness {
  const nextIndex = findNextResolutionIndexFromRoot(root);
  const tree = createZkusdResolutionNullifierTree(nextIndex);

  const previousWitness = tree.getWitness(BigInt(nextIndex - 1));
  const currentWitness = tree.getWitness(BigInt(nextIndex));

  return new ZkusdEngineUpdateWitness({
    previousWitness: new ZkusdResolutionWitness(previousWitness),
    currentWitness: new ZkusdResolutionWitness(currentWitness),
  });
}
