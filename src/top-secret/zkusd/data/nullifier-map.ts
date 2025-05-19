import { Experimental, Field, MerkleMap, MerkleMapWitness } from 'o1js';
import { Bool } from 'o1js';

/**
 * A MerkleMap that stores nullifiers.
 *
 * - Keys are nullifiers (as `Field`).
 * - Values are `Bool` indicating if the nullifier has been spent.
 */

const NULLIFIER_MAP_HEIGHT = 52; // 1,099,511,627,776 - 1 trillion

const { IndexedMerkleMap } = Experimental;

export class NullifierMap extends IndexedMerkleMap(NULLIFIER_MAP_HEIGHT) {}
