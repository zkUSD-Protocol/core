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
  UInt32,
  UInt8,
} from 'o1js';
import { ZkusdCouncilMerkleMap } from '../../proofs/council-management/common.js';

export class ZkusdCouncilManagementOperation extends Struct({
  councilKey: PublicKey,
  councilSeatPosition: Field,
  shouldAdd: Bool, // if true, add the council member, otherwise remove the member
  isDummy: Bool, // if true, the operation is a dummy operation and will not be executed
}) {
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
  static MaxLength = CouncilManagementActionCount;

  toFields(): Field[] {
    return this.actions.map((action) => action.toFields()).flat();
  }
}

export class ZkusdCouncilManagementSpec extends Struct({
  councilManagementActions: ZkusdCouncilManagementActions,
  newVoteThreshold: UInt8,
}) {
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
  currentCouncilMap: ZkusdCouncilMerkleMap,
  councilManagementSpec: ZkusdCouncilManagementSpec,
}) {}
