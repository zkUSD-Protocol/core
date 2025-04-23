/**
 * ZKUSD Governance Module
 *
 * This module defines structures, constants, and types used in the setup and operation
 * of the ZKUSD Governing Council and its state update mechanism.
 *
 * Dependencies:
 * - `o1js`: Provides cryptographic primitives like `MerkleWitness`, `Provable`, `PublicKey`, `Struct`, and `UInt32`.
 * - `ZkUsdGovernmentContract`: Smart contract handling ZKUSD governance logic.
 */

import { MerkleWitness, Provable, PublicKey, Struct, UInt32 } from 'o1js';
import { ZkUsdGovernmentContract } from '../contracts/zkusd-base-gov-contract.js';

/**
 * Maximum number of initial council members allowed.
 */
export const InitialCouncilMembersMaxCount = 7;

/**
 * Struct representing the initial council members' public keys.
 *
 * - Fixed-size array (length 7).
 * - Used during the initial setup of the ZKUSD governance council.
 */
export class InitialCouncilMembers extends Struct({
  councilMembers: Provable.Array(PublicKey, InitialCouncilMembersMaxCount),
}) {
  /**
   * Maximum allowed number of council members.
   */
  static MaxLength = InitialCouncilMembersMaxCount; // limited by the event size
}

/**
 * Height of the Merkle tree for ZKUSD governance updates.
 *
 * Supports up to 2^19 = 524,288 entries.
 */
export const ZKUSD_GOV_UPDATE_TREE_HEIGHT = 20;

/**
 * Merkle Witness class used to prove membership or updates in the
 * ZKUSD governance Merkle tree.
 */
export class ZkusdGovUpdateWitness extends MerkleWitness(
  ZKUSD_GOV_UPDATE_TREE_HEIGHT
) {}

/**
 * Constructor type for the ZkUsdGovernmentContract.
 *
 * Accepts a `PublicKey` address to initialize a governance contract instance.
 */
export type ZkUsdGovernmentConstructor = new (
  address: PublicKey
) => ZkUsdGovernmentContract;

/**
 * Special UInt32 value representing a "no resolution" index.
 *
 * Used as a sentinel value when no valid resolution is present.
 */
export const NO_RESOLUTION_INDEX = UInt32.from(4200000000);
