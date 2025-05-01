/**
 * ZKUSD Council Management Specification Module
 *
 * Defines a specification struct representing a complete ZKUSD council management operation,
 * including operations to add and remove council members and update voting thresholds.
 */

import {
  Field,
  PublicKey,
  Struct,
  Bool,
  Provable,
  Poseidon,
  UInt8,
} from 'o1js';
import { CouncilMap, CouncilMapProvable } from '../data/council-map.js';
import {
  CouncilKeyWithIntent,
  CouncilUpdateActions,
  CouncilUpdateIntent,
  CouncilUpdateOperation,
} from './common.js';

/**
 * A complete specification for updating the council membership and voting threshold.
 * Combines both the management actions and the new vote threshold into a single unit.
 */
import { Seat } from '../seat.js';

export const CouncilUpdateActionCount = 10; // limited by the event size

export class CouncilUpdateSpec extends Struct({
  /** Collection of council membership update operations */
  councilManagementActions: CouncilUpdateActions,
  /** The new vote threshold to be set after the update */
  newVoteThreshold: UInt8,
}) {
  /**
   * Creates an empty CouncilUpdateSpec with no operations and zero threshold.
   *
   * @returns An empty CouncilUpdateSpec
   */
  static empty(): CouncilUpdateSpec {
    return new CouncilUpdateSpec({
      councilManagementActions: CouncilUpdateActions.empty(),
      newVoteThreshold: UInt8.from(0),
    });
  }

  /**
   * Computes the cryptographic hash of this update specification.
   * Used for voting and consensus on the proposed update.
   *
   * @returns A Field containing the hash of the specification
   */
  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  /**
   * Converts the specification to an array of Fields for hashing and consensus.
   *
   * @returns An array of Field elements representing this specification
   */
  toFields(): Field[] {
    return [
      ...this.councilManagementActions.toFields(),
      this.newVoteThreshold.value,
    ];
  }
}

/**
 * Input structure for a council update vote transaction. Used as the PublicInput of the proof.
 * Contains both the current state of the council and the proposed changes.
 */
export class CouncilUpdateVoteInput extends Struct({
  /** The current state of the council membership merkle map */
  currentCouncilMap: CouncilMapProvable,
  /** The proposed changes to council membership and threshold */
  councilManagementSpec: CouncilUpdateSpec,
}) {
  /**
   * Creates an empty CouncilUpdateVoteInput with default values.
   *
   * @returns An empty CouncilUpdateVoteInput
   */
  static empty(): CouncilUpdateVoteInput {
    return new CouncilUpdateVoteInput({
      currentCouncilMap: new CouncilMapProvable(),
      councilManagementSpec: CouncilUpdateSpec.empty(),
    });
  }

  /**
   * Creates input for updating council members (adding or removing) and updating threshold.
   * This is the most general method that supports any combination of add/remove operations.
   *
   * @param currentCouncilMap - The current council map.
   * @param newVoteThreshold - The new vote threshold to set.
   * @param keyIntents - Array of public keys with associated intents (add or remove).
   * @returns A CouncilUpdateVoteInput configured with the requested changes
   * @throws If the number of operations exceeds the maximum allowed
   */
  static createFromIntentsWithThreshold(
    currentCouncilMap: CouncilMap,
    newVoteThreshold: UInt8,
    keyIntents: CouncilKeyWithIntent[]
  ): CouncilUpdateVoteInput {
    if (keyIntents.length > CouncilUpdateActions.MaxLength) {
      throw new Error(
        `Too many council operations. Maximum allowed is ${CouncilUpdateActions.MaxLength}`
      );
    }

    let councilManagementActions = new CouncilUpdateActions({
      actions: [],
    });

    const operations = currentCouncilMap.createActionsFromIntents(keyIntents);
    councilManagementActions.actions.push(...operations);

    // pad up to MaxLength with dummy operations
    for (let i = operations.length; i < CouncilUpdateActions.MaxLength; i++) {
      councilManagementActions.actions.push(CouncilUpdateOperation.dummy());
    }

    const councilManagementSpec = new CouncilUpdateSpec({
      councilManagementActions,
      newVoteThreshold,
    });

    return new CouncilUpdateVoteInput({
      currentCouncilMap: currentCouncilMap.provable,
      councilManagementSpec,
    });
  }

  /**
   * Creates input for adding new council members and updating the vote threshold.
   * Convenient helper method for the common case of adding members.
   *
   * @param currentCouncilMap - The current council map.
   * @param newVoteThreshold - The new vote threshold to set.
   * @param newMemberKeys - Array of public keys for new council members to add.
   * @returns A CouncilUpdateVoteInput configured to add the specified members
   * @throws If the number of new members exceeds the maximum allowed
   */
  static addMembersAndUpdateThreshold(
    currentCouncilMap: CouncilMap,
    newVoteThreshold: UInt8,
    newMemberKeys: PublicKey[]
  ): CouncilUpdateVoteInput {
    const keyIntents: CouncilKeyWithIntent[] = newMemberKeys.map((key) => ({
      key,
      intent: CouncilUpdateIntent.Add,
    }));

    return CouncilUpdateVoteInput.createFromIntentsWithThreshold(
      currentCouncilMap,
      newVoteThreshold,
      keyIntents
    );
  }

  /**
   * Creates input for removing council members and updating the vote threshold.
   * Convenient helper method for the common case of removing members.
   *
   * @param currentCouncilMap - The current council map.
   * @param newVoteThreshold - The new vote threshold to set.
   * @param membersToRemove - Array of public keys of council members to remove.
   * @returns A CouncilUpdateVoteInput configured to remove the specified members
   * @throws If the number of members to remove exceeds the maximum allowed
   */
  static removeMembersAndUpdateThreshold(
    currentCouncilMap: CouncilMap,
    newVoteThreshold: UInt8,
    membersToRemove: PublicKey[]
  ): CouncilUpdateVoteInput {
    const keyIntents: CouncilKeyWithIntent[] = membersToRemove.map((key) => ({
      key,
      intent: CouncilUpdateIntent.Remove,
    }));

    return CouncilUpdateVoteInput.createFromIntentsWithThreshold(
      currentCouncilMap,
      newVoteThreshold,
      keyIntents
    );
  }

  /**
   * Converts the input to an array of Fields for hashing and consensus.
   *
   * @returns An array of Field elements representing this input
   */
  toFields(): Field[] {
    return [
      this.currentCouncilMap.root,
      ...this.councilManagementSpec.toFields(),
    ];
  }
}
