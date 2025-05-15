import { MerkleMap, MerkleMapWitness } from 'o1js';

/**
 * A MerkleMap that stores nullifiers.
 *
 * - Keys are nullifiers (as `Field`).
 * - Values are `Bool` indicating if the nullifier has been spent.
 */

export class NullifierMap extends MerkleMap {}

export class NullifierWitness extends MerkleMapWitness {}
