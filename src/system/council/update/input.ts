/**
 * ZKUSD Council Management Specification Module
 *
 * Defines a specification struct representing a complete ZKUSD council management operation,
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
import { Seat } from '../seat.js';

export class CouncilUpdateOperation extends Struct({
  member: PublicKey,
  seat: Seat,
  shouldAdd: Bool, // if true, add the council member, otherwise remove the member
  isDummy: Bool, // if true, the operation is a dummy operation and will not be executed
}) {
  static dummy(): CouncilUpdateOperation {
    return new CouncilUpdateOperation({
      member: PublicKey.empty(),
      seat: Seat.fromIndex(0),
      shouldAdd: Bool(false),
      isDummy: Bool(true),
    });
  }

  toFields(): Field[] {
    return [
      ...this.member.toFields(),
      this.seat.value,
      ...this.shouldAdd.toFields(),
      ...this.isDummy.toFields(),
    ];
  }
}
export const CouncilUpdateActionCount = 10; // limited by the event size

export class CouncilUpdateActions extends Struct({
  actions: Provable.Array(
    CouncilUpdateOperation,
    CouncilUpdateActionCount
  ),
}) {
  static empty(): CouncilUpdateActions {
    return new CouncilUpdateActions({
      actions: Array.from({ length: CouncilUpdateActionCount }, () =>
        CouncilUpdateOperation.dummy()
      ),
    });
  }

  static MaxLength = CouncilUpdateActionCount;
  toFields(): Field[] {
    return this.actions.map((action) => action.toFields()).flat();
  }
}

export class CouncilUpdateSpec extends Struct({
  councilManagementActions: CouncilUpdateActions,
  newVoteThreshold: UInt8,
}) {
  static empty(): CouncilUpdateSpec {
    return new CouncilUpdateSpec({
      councilManagementActions: CouncilUpdateActions.empty(),
      newVoteThreshold: UInt8.from(0),
    });
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  toFields(): Field[] {
    return [
      ...this.councilManagementActions.toFields(),
      this.newVoteThreshold.value,
    ];
  }
}

export class CouncilUpdateVoteInput extends Struct({
  currentCouncilMap: CouncilMapProvable,
  councilManagementSpec: CouncilUpdateSpec,
}) {
  static empty(): CouncilUpdateVoteInput {
    return new CouncilUpdateVoteInput({
      currentCouncilMap: new CouncilMapProvable(),
      councilManagementSpec: CouncilUpdateSpec.empty(),
    });
  }

  static addMembersAndUpdateThreshold(
    currentCouncilMap: CouncilMap,
    newVoteThreshold: UInt8,
    newMemberKeys: PublicKey[]
  ): CouncilUpdateVoteInput {
    if (newMemberKeys.length > CouncilUpdateActions.MaxLength) {
      throw new Error(
        `Too many member keys. Maximum allowed is ${CouncilUpdateActions.MaxLength}`
      );
    }

    let councilManagementActions = new CouncilUpdateActions({
      actions: [],
    });

    const operations = currentCouncilMap.createAddActions(newMemberKeys);
    councilManagementActions.actions.push(...operations);
    // pad up to MaxLength with dummy
    for (let i = newMemberKeys.length; i < CouncilUpdateActions.MaxLength; i++) {
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

  toFields(): Field[] {
    return [
      this.currentCouncilMap.root,
      ...this.councilManagementSpec.toFields(),
    ];
  }
}
