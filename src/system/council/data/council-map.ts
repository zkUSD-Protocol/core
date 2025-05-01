import {
  Bool,
  Field,
  MerkleWitness,
  Poseidon,
  PublicKey,
  UInt8,
} from 'o1js';
import { IndexedMerkleMap } from 'o1js/dist/node/lib/provable/merkle-tree-indexed';
import { CouncilUpdateOperation } from '../update/input.js';

/**
 * Height of the Merkle tree for council members.
 * Supports up to 256 slots (2^8), though usage is capped below.
 */
const ZKUSD_COUNCIL_MAP_HEIGHT = 9;

/**
 * Maximum number of supported council members.
 * Capped at 240 to stay within safe bit constraints for ZK circuits (fits in a single field).
 */
const MAX_COUNCIL_MEMBERS = 240;

/**
 * A typed MerkleWitness specific to council members.
 * Used for generating inclusion proofs in the CouncilMap.
 */
class CouncilMemberWitness extends MerkleWitness(
  ZKUSD_COUNCIL_MAP_HEIGHT
) {
  /** Height of the Merkle tree used by this witness. */
  static readonly HEIGHT = ZKUSD_COUNCIL_MAP_HEIGHT;
}

// a rewrite of the class below that can store public keys 
// but also be used as a provable type
export class CouncilMapProvable extends IndexedMerkleMap(CouncilMemberWitness.HEIGHT) {

}
  


/**
 * A Merkle map structure holding public keys of seated council members.
 */
export class CouncilMap {

  private readonly provableMap: CouncilMapProvable;

  /** Public accessor to the provable map, that clones it. */
  public get provable(): CouncilMapProvable {
    return this.provableMap.clone();
  }

  public get root(): Field {
    return this.provableMap.root;
  }
  
  /** Logical cap on the number of members, used to avoid underconstrained ZK circuits. */
  static readonly SEAT_LIMIT = MAX_COUNCIL_MEMBERS;

  /** Array of public keys representing seated council members. */
  private readonly _seatingKeys: Map<Field, PublicKey> = new Map();

  /** Map from public key to its seat key (seat field value) */
  private readonly _pubkeyToSeatKey: Map<string, Field>;

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
  constructor(seatingKeys: PublicKey[] =[]) {
    this.provableMap = new CouncilMapProvable();

    if (seatingKeys.length > CouncilMap.SEAT_LIMIT) {
      throw new Error(
        `Council tree exceeds maximum allowed size of ${CouncilMap.SEAT_LIMIT}`
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

    this._pubkeyToSeatKey = new Map();

    seatingKeys.forEach((key, index) => {
      const seatKey = CouncilMap.keyFromIndex(index);
      const leafValue = CouncilMap.hashCouncilSeat(key);
      this.provableMap.insert(seatKey, leafValue);
      this._pubkeyToSeatKey.set(key.toBase58(), seatKey);
      this._seatingKeys.set(seatKey, key);
    });
  }
  /**
   * Returns the map of seat keys to public keys.
   */
  public get seatingKeys(): Map<Field, PublicKey> {
    return this._seatingKeys;
  }

  /**
   * Inserts a council member's public key into the next available seat.
   * @param councilKey - The public key of the council member to be seated.
   * @returns The key of the seat where the council member was seated.
   */
  public insertAtNextEmptyKey(councilKey: PublicKey): Field {
    const key = this.getNextEmptyKey();
    this.insertAtKey(councilKey, key);
    return key;
  }

  /**
   * Inserts a council member's public key into a specific seat.
   * Will fail if the seat is already occupied.
   * @param councilKey - The public key of the council member to be seated.
   * @param key - The key of the seat where the council member should be seated.
   */
  public insertAtKey(councilKey: PublicKey, key: Field): void {
    // check if the public key is already seated
    if (!councilKey.isEmpty() && this._pubkeyToSeatKey.has(councilKey.toBase58())) {
      throw new Error('Council key already seated');
    }
    const value = CouncilMap.hashCouncilSeat(councilKey);
    // will fail on override
    this.provableMap.getOption(key).assertNone();
    this.provableMap.insert(key, value);
    this._pubkeyToSeatKey.set(councilKey.toBase58(), key);
  }
  
  /**
   * Returns the index of the next available seat.
   */
  public getNextEmptyKey(): Field {
    const seatFieldIndices: bigint[] = this.provableMap.data.get().sortedLeaves.map(leaf => leaf.key);
    
    // prepare an array of 0..SEAT_LIMIT, empty seats bool[]
    const emptySeats: boolean[] = new Array(CouncilMap.SEAT_LIMIT).fill(false);

    // now for each seatFieldIndex, mark the corresponding emptySeats index as true,
    // but seatFieldIndex is 2**index, so index is log2(seatFieldIndex)
    seatFieldIndices.forEach(index => {
      emptySeats[Number(Math.log2(Number(index)))] = true;
    });

    // now return the first empty seat
    for (let i = 0; i < CouncilMap.SEAT_LIMIT; i++) {
      if (!emptySeats[i]) {
        return Field.from(2n ** BigInt(i));
      }
    }
    throw new Error('Council size limit reached');
  }

  /**
   * For given seat key (seat field value - 2**index) returns the public key
   * that is seated in that seat.
   * @param seatKey - The seat key of the public key.
   * @returns The public key of the seated council member, or undefined if the seat is empty.
   */
  public getSeatPublicKey(seatKey:Field | bigint | number | UInt8): PublicKey | undefined {
    const seatField = seatKey instanceof Field
      ? seatKey
      : seatKey instanceof UInt8
        ? Field.from(seatKey.toNumber())
        : Field.from(seatKey);
    return this.seatingKeys.get(seatField);
  }

  public getPubkeySeatKey(key: PublicKey): Field | undefined {
    return this._pubkeyToSeatKey.get(key.toBase58());
  }

  /**
   * Returns the hash of a council seat. It is a helper so that
   * later we can change the hash function in a central location 
   * @param key - The public key of the council member.
   * @returns The hash of the council seat.
   */
  public static hashCouncilSeat(key: PublicKey): Field {
    return Poseidon.hash([...key.toFields()]);
  }
  
  /**
   * Returns the key (seat field value = 2**index) of a council seat from its index.
   * @param index - The index of the seat.
   * @returns The key of the seat.
   */
  public static keyFromIndex(index: number): Field {
    return Field.from(2n ** BigInt(index));
  }

  /**
   * Clones the tree preserving the current mapping.
   */
  public clone(): CouncilMap {
    const leaves = this.provableMap.data.get().sortedLeaves;
    const pubkeys = this._seatingKeys;
    // value to pubkey map
    const valueToPubkey = new Map();
    pubkeys.forEach(pubkey => {
      valueToPubkey.set(CouncilMap.hashCouncilSeat(pubkey), pubkey);
    });
    const ret = new CouncilMap([]);
    leaves.forEach(leaf => {
      ret.insertAtKey(valueToPubkey.get(leaf.value), Field.from(leaf.key));
    });
    return ret;
  }

  public remove(key: Field): void {

  }

  // --------------- CouncilUpdateOperation ---------------

  public static buildFromOperations(operations: CouncilUpdateOperation[]): CouncilMap {
    const councilMap = new CouncilMap([]);
    operations.forEach(operation => {
      if (operation.isDummy.toBoolean()) {
        return;
      }
      if (operation.shouldAdd.toBoolean()) {
        councilMap.insertAtKey(operation.councilKey, operation.councilSeatPosition);
      } 
        });
    return councilMap;
  }

  public applyOperations(operations: CouncilUpdateOperation[]): void {
    operations.forEach(operation => {
      if (operation.isDummy.toBoolean()) {
        return;
      }
      if (operation.shouldAdd.toBoolean()) {
        this.insertAtKey(operation.councilKey, operation.councilSeatPosition);
      }
    });
  }


  /**
   * Creates a set of management operations for adding new council members.
   * @param councilKeys - Array of public keys of the new council members.
   * @returns An array of CouncilUpdateOperation instances.
   */
  public createAddActions(councilKeys: PublicKey[]): CouncilUpdateOperation[] {
    const cloned = this.clone();
    const nextEmptyKeys: Field[] = [];
    for (const key of councilKeys) {
      nextEmptyKeys.push(cloned.insertAtNextEmptyKey(key));
    }
    const actions = councilKeys.map((key, i) => new CouncilUpdateOperation({
      councilKey: key,
      councilSeatPosition: nextEmptyKeys[i],
      shouldAdd: Bool(true),
      isDummy: Bool(false),
    }));
    return actions;
  }

}

/**
 * Type-safe access to the witness type for external use.
 */
export namespace CouncilMap {
  export type Witness = CouncilMemberWitness;
}
