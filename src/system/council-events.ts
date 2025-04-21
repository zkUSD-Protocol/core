import { Field, Provable, PublicKey, Struct, UInt32 } from "o1js";
import { InitialCouncilMembers } from "./governance.js";


export class CouncilProposalSupportChangeEvent extends Struct({
  proposalTreeRootBefore: Field,
  acceptedVoteBitArray: Field,
  proposalHash: Field,
  resolutionIndex: UInt32,
}) {}

export class CouncilProposalPassedEvent extends Struct({
  proposalHash: Field,
  resolutionIndex: UInt32,
}) {}

export class NewCouncilInitializedWithFixedKeysEvent extends Struct({
  councilMerkleRoot: Field,
  councilMembers: InitialCouncilMembers
}) {}


export class NewCouncilInitializedEvent extends Struct({
  councilMerkleRoot: Field,
}) {}


/**
 * Given a list of events, finds the first event of type 'NewCouncilInitializedWithFixedKeys',
 * reads the councilMembers array from its data, and returns all non-empty public keys.
 */
export function getNewCouncilMembers(
  events: any[]
): PublicKey[] {

  for (const event of events) {
    console.log('event type:', event.type);
  }
  const targetEvent = events.find(
    (e) => e.type === 'NewCouncilInitializedWithFixedKeys'
  );
  if (!targetEvent) {
    return [];
  }

  const eventData = targetEvent.event?.data;

  // Cast to the known class type (if applicable)
  const newCouncilEvent = eventData as unknown as NewCouncilInitializedWithFixedKeysEvent;

  // Extract the array of council members
  const councilMemberArray = newCouncilEvent.councilMembers.councilMembers;

  // Filter out empty keys using .isEmpty()
  const nonEmptyMembers = councilMemberArray.filter((pk) => !pk.isEmpty().toBoolean())

  return nonEmptyMembers;
}
