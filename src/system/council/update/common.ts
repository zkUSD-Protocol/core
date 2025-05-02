import { Bool, Field, Provable, PublicKey, Struct } from 'o1js';
import { Seat } from '../seat.js';
import { COUNCIL_UPDATE_ACTION_COUNT } from '../data/common-constants.js';
/**
 * Defines the intention for a council member update operation.
 * Used to determine whether to add or remove a council member.
 */
export enum CouncilUpdateIntent {
  /** Add a new council member to the council */
  Add = 'add',
  /** Remove an existing council member from the council */
  Remove = 'remove',
}

/**
 * Represents a key with an associated update intent.
 * Used to build council update operations with a clear intention.
 */
export interface CouncilKeyWithIntent {
  /** The public key of the council member */
  key: PublicKey;
  /** The intention: whether to add or remove this key */
  intent: CouncilUpdateIntent;
}

/**
 * Represents a single council update operation.
 * Each operation targets a specific council seat and can either add or remove a member.
 */
export class CouncilUpdateOperation extends Struct({
  /** The public key of the council member being added or removed */
  member: PublicKey,
  /** The seat position in the council map (represented as a Field = 2^index) */
  seat: Seat,
  /** If true, add the council member; if false, remove the member */
  shouldAdd: Bool,
  /** If true, the operation is a dummy operation and will not be executed */
  isDummy: Bool,
}) {
  /**
   * Creates a dummy operation that will be ignored during execution.
   * Used for padding operation arrays to a fixed length.
   *
   * @returns A dummy CouncilUpdateOperation
   */
  static dummy(): CouncilUpdateOperation {
    return new CouncilUpdateOperation({
      member: PublicKey.empty(),
      seat: Seat.fromIndex(0),
      shouldAdd: Bool(false),
      isDummy: Bool(true),
    });
  }

  /**
   * Converts the operation to an array of Fields for hashing and consensus.
   *
   * @returns An array of Field elements representing this operation
   */
  toFields(): Field[] {
    return [
      ...this.member.toFields(),
      this.seat.value,
      ...this.shouldAdd.toFields(),
      ...this.isDummy.toFields(),
    ];
  }
}

/**
 * A fixed-size collection of council update operations.
 * Contains exactly CouncilUpdateActionCount operations, padded with dummy operations as needed.
 */
export class CouncilUpdateActions extends Struct({
  /** Array of council update operations, exactly CouncilUpdateActionCount in length */
  actions: Provable.Array(CouncilUpdateOperation, COUNCIL_UPDATE_ACTION_COUNT),
}) {
  /**
   * Creates an empty CouncilUpdateActions with all dummy operations.
   *
   * @returns A CouncilUpdateActions instance filled with dummy operations
   */
  static empty(): CouncilUpdateActions {
    return new CouncilUpdateActions({
      actions: Array.from({ length: COUNCIL_UPDATE_ACTION_COUNT }, () =>
        CouncilUpdateOperation.dummy()
      ),
    });
  }

  /** Reference to the maximum allowed actions for convenience */
  static MaxLength = COUNCIL_UPDATE_ACTION_COUNT;

  /**
   * Converts the actions to an array of Fields for hashing and consensus.
   *
   * @returns An array of Field elements representing all operations
   */
  toFields(): Field[] {
    return this.actions.map((action) => action.toFields()).flat();
  }
}
