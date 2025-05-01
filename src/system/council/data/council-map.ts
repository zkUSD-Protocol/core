import {
  Bool,
  Field,
  MerkleWitness,
  Poseidon,
  PublicKey,
  UInt8,
  Experimental,
} from 'o1js';

import {
  CouncilKeyWithIntent,
  CouncilUpdateActions,
  CouncilUpdateIntent,
  CouncilUpdateOperation,
} from '../update/common.js';
import { Seat } from '../seat.js';

const { IndexedMerkleMap } = Experimental;

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
class CouncilMemberWitness extends MerkleWitness(ZKUSD_COUNCIL_MAP_HEIGHT) {
  /** Height of the Merkle tree used by this witness. */
  static readonly HEIGHT = ZKUSD_COUNCIL_MAP_HEIGHT;
}

// a rewrite of the class below that can store public keys
// but also be used as a provable type
export class CouncilMapProvable extends IndexedMerkleMap(
  CouncilMemberWitness.HEIGHT
) {}

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
  private readonly _seatingKeys: Map<Seat, PublicKey> = new Map();

  /** Map from public key to its seat key (seat field value) */
  private readonly _pubkeyToSeatKey: Map<string, Seat>;

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
  constructor(seatingKeys: PublicKey[] = []) {
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
      const seat = Seat.fromIndex(index);
      const leafValue = CouncilMap.hashCouncilSeat(key);
      this.provableMap.insert(seat.value, leafValue);
      this._pubkeyToSeatKey.set(key.toBase58(), seat);
      this._seatingKeys.set(seat, key);
    });
  }
  /**
   * Returns the map of seat keys to public keys.
   */
  public get seatingKeys(): Map<Seat, PublicKey> {
    return this._seatingKeys;
  }

  /**
   * Inserts a council member's public key into the next available seat.
   * @param councilKey - The public key of the council member to be seated.
   * @returns The key of the seat where the council member was seated.
   */
  public insertAtNextEmptySeat(councilKey: PublicKey): Seat {
    const seat = this.getNextEmptySeat();
    this.insertAtSeat(councilKey, seat);
    return seat;
  }

  /**
   * Inserts a council member's public key into a specific seat.
   * Will fail if the seat is already occupied.
   * @param councilKey - The public key of the council member to be seated.
   * @param seat - The seat where the council member should be seated.
   */
  public insertAtSeat(councilKey: PublicKey, seat: Seat): void {
    // check if the public key is already seated
    if (
      !councilKey.isEmpty() &&
      this._pubkeyToSeatKey.has(councilKey.toBase58())
    ) {
      throw new Error('Council key already seated');
    }
    const value = CouncilMap.hashCouncilSeat(councilKey);
    // will fail on override
    this.provableMap.getOption(seat.value).assertNone();
    this.provableMap.insert(seat.value, value);
    this._pubkeyToSeatKey.set(councilKey.toBase58(), seat);
  }

  /**
   * Returns the next available seat.
   */
  public getNextEmptySeat(): Seat {
    const seatFieldIndices: bigint[] = this.provableMap.data
      .get()
      .sortedLeaves.map((leaf) => leaf.key);

    // prepare an array of 0..SEAT_LIMIT, empty seats bool[]
    const isEmptySeat: boolean[] = new Array(CouncilMap.SEAT_LIMIT).fill(true);

    // now for each seatFieldIndex, mark the corresponding emptySeats index as false,
    // but seatFieldIndex is 2**index, so index is log2(seatFieldIndex)
    seatFieldIndices.forEach((index) => {
      isEmptySeat[Number(Math.log2(Number(index)))] = false;
    });

    // now return the first empty seat
    for (let i = 0; i < CouncilMap.SEAT_LIMIT; i++) {
      if (isEmptySeat[i]) {
        return Seat.fromIndex(i);
      }
    }
    throw new Error('Council size limit reached');
  }

  /**
   * For given seat key (seat field value - 2**index) returns the public key
   * that is seated in that seat.
   * @param seat - The seat key of the public key.
   * @returns The public key of the seated council member, or undefined if the seat is empty.
   */
  public getSeatPublicKey(seat: Seat): PublicKey | undefined {
    return this.seatingKeys.get(seat);
  }

  public getPubkeySeatKey(key: PublicKey): Seat | undefined {
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
    pubkeys.forEach((pubkey) => {
      valueToPubkey.set(CouncilMap.hashCouncilSeat(pubkey), pubkey);
    });
    const ret = new CouncilMap([]);
    leaves.forEach((leaf) => {
      ret.insertAtSeat(
        valueToPubkey.get(leaf.value),
        Seat.fromField(Field(leaf.key))
      );
    });
    return ret;
  }

  /**
   * Removes a council member from their seat.
   * @param key - The key of the seat where the council member is seated.
   * @throws Error if the seat does not exist or is empty.
   */
  public remove(seat: Seat): void {
    // Check if the seat exists
    const seatValue = this.provableMap.get(seat.value);
    if (seatValue.equals(Field(0)).toBoolean()) {
      throw new Error('Cannot remove from an empty seat');
    }

    // Get the public key associated with this seat
    const publicKey = this._seatingKeys.get(seat);
    if (!publicKey) {
      throw new Error('Seat exists but no public key is associated with it');
    }

    // Remove the seat
    this.provableMap.set(seat.value, Field(0));
    this._seatingKeys.delete(seat);
    this._pubkeyToSeatKey.delete(publicKey.toBase58());
  }

  // --------------- CouncilUpdateOperation ---------------

  /**
   * Builds a CouncilMap by applying a series of update operations.
   * Handles both addition and removal operations.
   *
   * @param operations - Array of CouncilUpdateOperation instances to apply.
   * @returns A new CouncilMap with all operations applied.
   */
  public static buildFromOperations(
    operations: CouncilUpdateOperation[]
  ): CouncilMap {
    const councilMap = new CouncilMap([]);
    operations.forEach((operation) => {
      if (operation.isDummy.toBoolean()) {
        return;
      }

      if (operation.shouldAdd.toBoolean()) {
        // Handle additions
        councilMap.insertAtSeat(operation.member, operation.seat);
      } else {
        // Handle removals - the seat position tells us which seat to remove
        // We need to check if the seat exists first
        const publicKey = councilMap.getSeatPublicKey(operation.seat);
        if (publicKey) {
          councilMap.remove(operation.seat);
        }
      }
    });
    return councilMap;
  }

  /**
   * Applies a series of update operations to this CouncilMap instance.
   * Handles both addition and removal operations.
   *
   * @param operations - Array of CouncilUpdateOperation instances to apply.
   */
  public applyOperations(operations: CouncilUpdateOperation[]): void {
    operations.forEach((operation) => {
      if (operation.isDummy.toBoolean()) {
        return;
      }

      if (operation.shouldAdd.toBoolean()) {
        // Handle additions
        this.insertAtSeat(operation.member, operation.seat);
      } else {
        // Handle removals
        const publicKey = this.getSeatPublicKey(operation.seat);
        if (publicKey) {
          this.remove(operation.seat);
        }
      }
    });
  }

  /**
   * Creates a set of management operations based on council keys and their intents.
   * @param keyIntents - Array of public keys with associated intents (add or remove).
   * @returns An array of CouncilUpdateOperation instances.
   */
  public createActionsFromIntents(
    keyIntents: CouncilKeyWithIntent[]
  ): CouncilUpdateOperation[] {
    const cloned = this.clone();
    const actions: CouncilUpdateOperation[] = [];

    // Check to see if the keyIntent array is of valid length
    if (keyIntents.length > CouncilUpdateActions.MaxLength) {
      throw new Error(
        `The intent length ${keyIntents.length} exceeds the maximum allowed length of ${CouncilUpdateActions.MaxLength}`
      );
    }

    for (const { key, intent } of keyIntents) {
      if (intent === CouncilUpdateIntent.Add) {
        // For additions, find the next empty seat
        const nextEmptySeat = cloned.insertAtNextEmptySeat(key);
        actions.push(
          new CouncilUpdateOperation({
            member: key,
            seat: nextEmptySeat,
            shouldAdd: Bool(true),
            isDummy: Bool(false),
          })
        );
      } else if (intent === CouncilUpdateIntent.Remove) {
        // For removals, find the current seat of this key
        const seatKey = cloned.getPubkeySeatKey(key);
        if (!seatKey) {
          throw new Error(`Cannot remove council member: key not found`);
        }

        // Remove from the cloned map to keep tracking state
        cloned.remove(seatKey);

        actions.push(
          new CouncilUpdateOperation({
            member: key,
            seat: seatKey,
            shouldAdd: Bool(false),
            isDummy: Bool(false),
          })
        );
      }
    }

    return actions;
  }
}

/**
 * Type-safe access to the witness type for external use.
 */
export namespace CouncilMap {
  export type Witness = CouncilMemberWitness;
}
