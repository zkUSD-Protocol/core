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
import { CouncilMap, CouncilMapProvable } from '../council-map';

export class ZkusdCouncilManagementOperation extends Struct({
  councilKey: PublicKey,
  councilSeatPosition: Field,
  shouldAdd: Bool, // if true, add the council member, otherwise remove the member
  isDummy: Bool, // if true, the operation is a dummy operation and will not be executed
}) {
  static dummy(): ZkusdCouncilManagementOperation {
    return new ZkusdCouncilManagementOperation({
      councilKey: PublicKey.empty(),
      councilSeatPosition: Field.from(0),
      shouldAdd: Bool(false),
      isDummy: Bool(true),
    });
  }

  toFields(): Field[] {
    return [
      ...this.councilKey.toFields(),
      ...this.councilSeatPosition.toFields(),
      ...this.shouldAdd.toFields(),
      ...this.isDummy.toFields(),
    ];
  }
}
export const CouncilManagementActionCount = 10; // limited by the event size

export class ZkusdCouncilManagementActions extends Struct({
  actions: Provable.Array(
    ZkusdCouncilManagementOperation,
    CouncilManagementActionCount
  ),
}) {
  static empty(): ZkusdCouncilManagementActions {
    return new ZkusdCouncilManagementActions({
      actions: Array.from({ length: CouncilManagementActionCount }, () =>
        ZkusdCouncilManagementOperation.dummy()
      ),
    });
  }

  static MaxLength = CouncilManagementActionCount;
  toFields(): Field[] {
    return this.actions.map((action) => action.toFields()).flat();
  }
}

export class ZkusdCouncilManagementSpec extends Struct({
  councilManagementActions: ZkusdCouncilManagementActions,
  newVoteThreshold: UInt8,
}) {
  static empty(): ZkusdCouncilManagementSpec {
    return new ZkusdCouncilManagementSpec({
      councilManagementActions: ZkusdCouncilManagementActions.empty(),
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

export class ZkusdCouncilManagementInput extends Struct({
  currentCouncilMap: CouncilMapProvable,
  councilManagementSpec: ZkusdCouncilManagementSpec,
}) {
  static empty(): ZkusdCouncilManagementInput {
    return new ZkusdCouncilManagementInput({
      currentCouncilMap: new CouncilMapProvable(),
      councilManagementSpec: ZkusdCouncilManagementSpec.empty(),
    });
  }

  static addMembersAndUpdateThreshold(
    currentCouncilMap: CouncilMap,
    newVoteThreshold: UInt8,
    newMemberKeys: PublicKey[]
  ): ZkusdCouncilManagementInput {
    if (newMemberKeys.length > ZkusdCouncilManagementActions.MaxLength) {
      throw new Error(
        `Too many member keys. Maximum allowed is ${ZkusdCouncilManagementActions.MaxLength}`
      );
    }

    let councilManagementActions = new ZkusdCouncilManagementActions({
      actions: [],
    });

    const operations = currentCouncilMap.createAddActions(newMemberKeys);
    councilManagementActions.actions.push(...operations);
    // pad up to MaxLength with dummy
    for (let i = newMemberKeys.length; i < ZkusdCouncilManagementActions.MaxLength; i++) {
      councilManagementActions.actions.push(ZkusdCouncilManagementOperation.dummy());
    } 

    const councilManagementSpec = new ZkusdCouncilManagementSpec({
      councilManagementActions,
      newVoteThreshold,
    });

    return new ZkusdCouncilManagementInput({
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
