import {
  Field,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  PublicKey,
  UInt8,
} from 'o1js';

/**
 * Height of the Merkle tree for council members.
 * Supports up to 256 slots (2^8), though usage is capped below.
 */
const ZKUSD_COUNCIL_TREE_HEIGHT = 9;

/**
 * Maximum number of supported council members.
 * Capped at 240 to stay within safe bit constraints for ZK circuits (fits in a single field).
 */
const MAX_COUNCIL_MEMBERS = 240;

/**
 * A typed MerkleWitness specific to council members.
 * Used for generating inclusion proofs in the CouncilTree.
 */
class ZkusdCouncilMemberWitness extends MerkleWitness(
  ZKUSD_COUNCIL_TREE_HEIGHT
) {
  /** Height of the Merkle tree used by this witness. */
  static readonly HEIGHT = ZKUSD_COUNCIL_TREE_HEIGHT;
}

/**
 * A Merkle tree structure holding public keys of seated council members.
 *
 * - Provides fast key lookup via internal index mapping.
 * - Supports Merkle inclusion proofs for verifying membership.
 * - Hashes leaves using Poseidon over the public key and index field.
 */
export class CouncilTree extends MerkleTree {
  /** Height of the Merkle tree. Determines capacity. */
  static readonly HEIGHT = ZkusdCouncilMemberWitness.HEIGHT;

  /** Typed witness class used for proof generation. */
  static readonly Witness = ZkusdCouncilMemberWitness;

  /** Logical cap on the number of members, used to avoid underconstrained ZK circuits. */
  static readonly MAX_SIZE = MAX_COUNCIL_MEMBERS;

  /** Array of public keys representing seated council members. */
  private readonly _seatingKeys: PublicKey[];

  /** Map from public key (as base58 string) to its index in the tree. Enables fast lookup. */
  private readonly _keyToIndex: Map<string, number>;

  /**
   * Initializes a new CouncilTree from an array of public keys.
   *
   * - Ensures the number of keys does not exceed `MAX_SIZE`.
   * - Rejects duplicate public keys (based on their Base58 representation).
   * - Computes and inserts Merkle leaves based on hashed keys + indices.
   * - Builds an internal Map for fast key-to-index lookup.
   *
   * @param seatingKeys - An array of unique council member public keys.
   * @throws If the number of keys exceeds `MAX_SIZE` or contains duplicates.
   */
  constructor(seatingKeys: PublicKey[]) {
    super(CouncilTree.HEIGHT);

    if (seatingKeys.length > CouncilTree.MAX_SIZE) {
      throw new Error(
        `Council tree exceeds maximum allowed size of ${CouncilTree.MAX_SIZE}`
      );
    }

    // Check for duplicate public keys
    const seen = new Set<string>();
    for (const key of seatingKeys) {
      if (key.isEmpty().toBoolean()) {
        continue;
      }
      const b58 = key.toBase58();
      if (seen.has(b58)) {
        throw new Error(`Duplicate council key detected: ${b58}`);
      }
      seen.add(b58);
    }

    this._seatingKeys = seatingKeys;
    this._keyToIndex = new Map();

    seatingKeys.forEach((key, index) => {
      const leaf = CouncilTree.hashCouncilSeat(key, index);
      this.setLeaf(BigInt(index), leaf);
      this._keyToIndex.set(key.toBase58(), index);
    });
  }
  /**
   * Returns the full list copy of council public keys.
   */
  public get seatingKeys(): PublicKey[] {
    return [...this._seatingKeys];
  }

  /**
   * Returns the public key at a specific index.
   */
  public getSeatKey(index: number | bigint | UInt8): PublicKey {
    const i = Number(index instanceof UInt8 ? index.toBigInt() : BigInt(index));
    if (i < 0 || i >= this._seatingKeys.length) {
      throw new Error(`Index ${i} is out of bounds`);
    }
    return this._seatingKeys[i];
  }

  /**
   * Returns a witness for a given council public key.
   * Fast O(1) lookup using internal Map.
   */
  public getKeyWitness(key: PublicKey): ZkusdCouncilMemberWitness {
    const index = this._keyToIndex.get(key.toBase58());

    if (index === undefined) {
      throw new Error('Council key not found in the tree');
    }

    return this.getWitnessWrapped(index);
  }

  /**
   * Returns a Merkle witness for the council member at the given index.
   *
   * @param index - Index in the tree (0-based).
   * @returns A typed Merkle witness.
   */
  public getWitnessWrapped(index: number | bigint): ZkusdCouncilMemberWitness {
    return new CouncilTree.Witness(this.getWitness(BigInt(index)));
  }

  /**
   * Hashes a council member's public key and position into a Merkle leaf.
   * Uses Poseidon hash over (2^index, ...publicKeyFields).
   *
   * @param key - The public key of the council member.
   * @param index - Index in the tree.
   * @returns Field representing the Merkle leaf.
   */
  static hashCouncilSeat(key: PublicKey, index: number): Field {
    const indexField = Field.from(1n << BigInt(index));
    return CouncilTree.hashCouncilSeatProvable(key, indexField);
  }
  /**
   * Hashes a council member's public key and a provided index field into a Merkle leaf.
   *
   * @param councilKey - The public key of the council member.
   * @param indexFieldValue - A `Field` representing 2^index or other provable index input.
   * @returns A `Field` representing the hashed Merkle leaf.
   */
  static hashCouncilSeatProvable(
    councilKey: PublicKey,
    indexFieldValue: Field
  ): Field {
    return Poseidon.hash([indexFieldValue, ...councilKey.toFields()]);
  }
}

/**
 * Type-safe access to the witness type for external use.
 */
export namespace CouncilTree {
  export type Witness = ZkusdCouncilMemberWitness;
}
