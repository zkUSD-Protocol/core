/**
 * Height of the Merkle tree for council members.
 * Supports up to 256 slots (2^8), though usage is capped below.
 */
export const ZKUSD_COUNCIL_MAP_HEIGHT = 9;

/**
 * Maximum number of supported council members.
 * Capped at 240 to stay within safe bit constraints for ZK circuits (fits in a single field).
 */
export const MAX_COUNCIL_MEMBERS = 240;

/**
 * Maximum number of council update actions that can be included in a single proposal.
 * Limited by the event size in the contract.
 */
export const COUNCIL_UPDATE_ACTION_COUNT = 10;
