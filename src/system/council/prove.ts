import { Field, PublicKey, Signature, UInt8 } from 'o1js';
import { CouncilMap } from './council-map.js';
import { GovernanceUpdate } from '../../proofs/governance-update/prove.js';
import { ZkusdProtocolUpdateSpec } from '../governance-update/input.js';

/**
 * Proves that a council member voted in favor of a governance update.
 *
 * @param {ZkusdProtocolUpdateSpec} updateSpec
 *   The governance update specification.
 * @param {Signature} signature
 *   The signature of the council member.
 * @param {CouncilMap} councilMap
 *   The council map containing the council members.
 * @param {UInt8|number|bigint|PublicKey} seat
 *   The seat of the council member, either a UInt8, number, bigint, or PublicKey.
 *   Pass either the public key or the index of the seat not the field value of
 *   the index.
 * @returns {Promise<GovernanceUpdate>} A proof of the council member's vote.
 */
export async function proveProposalSupport(
  updateSpec: ZkusdProtocolUpdateSpec,
  signature: Signature,
  councilMap: CouncilMap,
  seat: UInt8 | number | bigint | PublicKey
) {
  const pubkey = seat instanceof PublicKey ? seat : councilMap.getSeatPublicKey(seat)!

  // if seat is a PublicKey then we need to find the index of the seat
  // via the map
  const seatKey = councilMap.getPubkeySeatKey(pubkey)!;

  const { proof } = await GovernanceUpdate.createVote(
    updateSpec,
    signature,
    pubkey,
    councilMap.provable,
    seatKey
  );
  return proof;
}
