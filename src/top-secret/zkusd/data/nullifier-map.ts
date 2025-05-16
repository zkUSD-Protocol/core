import { Field, MerkleMap, MerkleMapWitness } from 'o1js';
import { Bool } from 'o1js';

/**
 * A MerkleMap that stores nullifiers.
 *
 * - Keys are nullifiers (as `Field`).
 * - Values are `Bool` indicating if the nullifier has been spent.
 */

export class NullifierMap extends MerkleMap {}

export class NullifierWitness extends MerkleMapWitness {
  static dummy(): NullifierWitness {
    // Create a temporary empty map
    const emptyMap = new NullifierMap();
    // Get a real witness for key Field(0), which should be empty by default
    return emptyMap.getWitness(Field(0));
  }
}
