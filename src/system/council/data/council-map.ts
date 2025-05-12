import { Field, PublicKey, Experimental, Poseidon, Bool, Provable } from 'o1js';

import {
  CouncilKeyWithIntent,
  CouncilUpdateActions,
  CouncilUpdateIntent,
  CouncilUpdateOperation,
} from '../update/common.js';
import { Seat } from '../seat.js';
import {
  MAX_COUNCIL_MEMBERS,
  ZKUSD_COUNCIL_MAP_HEIGHT,
} from './common-constants.js';

const { IndexedMerkleMap } = Experimental;

// a rewrite of the class below that can store public keys
// but also be used as a provable type
export class CouncilMapProvable extends IndexedMerkleMap(
  ZKUSD_COUNCIL_MAP_HEIGHT
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
  private readonly _seatingKeys: Map<bigint, string> = new Map();

  /** Map from public key to its seat key (seat field value) */
  private readonly _pubkeyToSeatKey: Map<string, bigint>;

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
      this._pubkeyToSeatKey.set(key.toBase58(), seat.value.toBigInt());
      this._seatingKeys.set(seat.value.toBigInt(), key.toBase58());
    });
  }
  /**
   * Returns the map of seat keys to public keys.
   */
  public get seatingKeys(): Map<bigint, string> {
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
    if (!councilKey.isEmpty() && this._pubkeyToSeatKey.has(councilKey.toBase58())) {
      throw new Error('Council key already seated');
    }

    if (this._seatingKeys.has(seat.value.toBigInt())) {
      throw new Error('Seat already occupied');
    }
    const value = CouncilMap.hashCouncilSeat(councilKey);
    // will fail on override
    this.provableMap.getOption(seat.value).assertNone();
    this.provableMap.insert(seat.value, value);
    this._pubkeyToSeatKey.set(councilKey.toBase58(), seat.value.toBigInt());
    this._seatingKeys.set(seat.value.toBigInt(), councilKey.toBase58());
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
    const pubkey = this.seatingKeys.get(seat.value.toBigInt());
    if (!pubkey) return undefined;
    return PublicKey.fromBase58(pubkey);
  }

  public getPubkeySeatKey(key: PublicKey): Seat | undefined {
    const seatKey = this._pubkeyToSeatKey.get(key.toBase58());
    if (!seatKey) return undefined;
    return Seat.fromField(Field(seatKey));
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
    const valueToPubkey = new Map<bigint, PublicKey>();
    pubkeys.forEach((pk58) => {
      const pubkey = PublicKey.fromBase58(pk58);
      valueToPubkey.set(CouncilMap.hashCouncilSeat(pubkey).toBigInt(), pubkey);
    });
    const ret = new CouncilMap([]);
    leaves.forEach((leaf) => {
      if (leaf.key === 0n) return;
      ret.insertAtSeat(
        valueToPubkey.get(leaf.value)!,
        Seat.fromField(Field(leaf.key))
      );
    });
    return ret;
  }

  // --------------- CouncilUpdateOperation ---------------

  public static buildFromOperations(
    operations: CouncilUpdateOperation[]
  ): CouncilMap {
    const councilMap = new CouncilMap([]);
    councilMap.applyOperations(...operations);
    return councilMap;
  }

  /**
   * Applies a series of update operations to this CouncilMap instance.
   * Handles both addition and removal operations.
   *
   * @param operations - Array of CouncilUpdateOperation instances to apply.
   */
  public applyOperations(...operations: CouncilUpdateOperation[]): void {
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
          this.removeCouncilMember(operation.seat);
        }
      }
    });
  }

  /**
   * Removes a council member from the CouncilMap.
   * @param seat - The seat of the council member to be removed.
   * @param force - If true, will throw an error if the seat is empty.
   */
  public removeCouncilMember(seat: Seat | PublicKey, force = false): void {
    // if seat is public key, find the seat
    let actualSeat: Seat;
    if (seat instanceof PublicKey) {
      const s = this.getPubkeySeatKey(seat);
      if (!s || force) {
        throw new Error('Given seat is empty');
      }
      actualSeat = s;
    } else {
      actualSeat = seat;
    }
    // remove the seat from the pubkeyToSeatKey map
    const pubkey = this.seatingKeys.get(actualSeat.value.toBigInt());
    if (pubkey) {
      this._pubkeyToSeatKey.delete(pubkey);
    } else if (force) {
      throw new Error('Given seat is empty');
    }
    // set 0 at the seat key in the provable
    this.provableMap.set(actualSeat.value, Field(0));
    // remove the seat from the seatingKeys map
    this._seatingKeys.delete(actualSeat.value.toBigInt());
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
        const memberKey = cloned.getPubkeySeatKey(key);
        if (!memberKey) {
          throw new Error(`Cannot remove council member: key not found`);
        }

        // Remove from the cloned map to keep tracking state
        cloned.removeCouncilMember(memberKey);

        actions.push(
          new CouncilUpdateOperation({
            member: key,
            seat: memberKey,
            shouldAdd: Bool(false),
            isDummy: Bool(false),
          })
        );
      }
    }

    return actions;
  }
}
