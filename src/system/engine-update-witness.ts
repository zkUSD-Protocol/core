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
export function computeResolutionProofNullifier(
  resolutionProof: ZkusdProtocolUpdateProof,
  resolutionWitness: ZkusdEngineUpdateWitness,
  currentRoot: Field
): Field {
  Provable.log('computeResolutionProofNullifier enter');
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
  Provable.log('current root does match currentWitness');

  const ret =  resolutionWitness.currentWitness.calculateRoot(Field(1));
  Provable.log('computeResolutionProofNullifier exit');
  return ret;
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

const MAX_LEAVES = 1 << (ZKUSD_UPDATE_TREE_HEIGHT - 1);

/**
 * Finds the next unused resolution index based solely on the Merkle root,
 * assuming the tree has a contiguous sequence of 1s starting at index 0.
 */
export function findNextResolutionIndexFromRoot(root: Field): number {
  console.log('findNextResolutionIndexFromRootLinear enter');

  // Create an empty Merkle tree
  const tree = new MerkleTree(ZKUSD_UPDATE_TREE_HEIGHT);

  // Mark the 0th leaf as used, which corresponds to "next index" = 1.
  tree.setLeaf(BigInt(0), Field(1));
  if (tree.getRoot().equals(root)) {
    console.log('findNextResolutionIndexFromRootLinear 1 exit');
    return 1;
  }

  // Check subsequent indices: i in [2..(MAX_LEAVES)]
  // Each “i” corresponds to marking leaf (i-1) as used.
  for (let i = 2; i <= MAX_LEAVES; i++) {
    // Mark leaf (i-1) as used
    tree.setLeaf(BigInt(i - 1), Field(1));

    if (tree.getRoot().equals(root)) {
      console.log(`findNextResolutionIndexFromRootLinear ${i} exit`);
      return i;
    }
  }

  throw new Error('Unable to resolve Merkle root to a valid next resolution index.');
}
