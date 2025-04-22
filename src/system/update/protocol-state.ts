import { Bool, UInt8, Field, Struct } from 'o1js';
import { ZkusdProtocolPreconditions } from './protocol-preconditions.js';

/**
 * @notice Represents the current on-chain state of the ZKUSD protocol.
 *
 * Fields:
 * - `emergencyStop` — Whether the protocol is paused (Bool).
 * - `collateralRatio` — Minimum required collateral ratio (UInt8).
 * - `validPriceBlockCount` — Number of valid blocks for oracle prices (UInt8).
 * - `liquidationBonusRatio` — Bonus ratio given during liquidation events (UInt8).
 * - `oracleWhitelistHash` — Merkle root hash of the oracle whitelist (Field).
 * - `configMerkleRoot` — Merkle root hash of the general protocol configuration (Field).
 *
 * This struct is primarily used to check if the protocol state satisfies
 * the expected update preconditions before applying a protocol update.
 */
export class ZkusdUpdateProtocolState extends Struct({
  emergencyStop: Bool,
  collateralRatio: UInt8,
  validPriceBlockCount: UInt8,
  liquidationBonusRatio: UInt8,
  oracleWhitelistHash: Field,
  configMerkleRoot: Field,
  // Additional fields can be added as needed
}) {
  /**
   * Validates if this protocol state matches the provided preconditions.
   *
   * @param preconditions - The expected `ZkusdProtocolPreconditions`.
   * @returns A `Bool` indicating whether the current state satisfies the preconditions.
   *
   * @example
   * const isValid = protocolState.isValidForPreconditions(preconditions);
   */
  isValidForPreconditions(preconditions: ZkusdProtocolPreconditions): Bool {
    return theUpdatePreconditionsMatchProtocolState({
      preconditions,
      protocolState: this,
    });
  }
}

/**
 * @internal
 * Helper function to compare a protocol state against a set of preconditions.
 *
 * Each field is checked individually: if the precondition for a field is unconstrained,
 * it automatically passes; otherwise, it must match exactly.
 *
 * @param args.preconditions - Expected preconditions.
 * @param args.protocolState - Actual protocol state to validate.
 * @returns A `Bool` indicating whether all conditions are satisfied.
 */
function theUpdatePreconditionsMatchProtocolState(args: {
  preconditions: ZkusdProtocolPreconditions;
  protocolState: ZkusdUpdateProtocolState;
}): Bool {
  const { preconditions, protocolState } = args;

  const emergencyStopOk = preconditions.emergencyStop.matches(
    protocolState.emergencyStop
  );

  const collateralRatioOk = preconditions.collateralRatio.matches(
    protocolState.collateralRatio
  );

  const validPriceCountOk = preconditions.validPriceBlockCount.matches(
    protocolState.validPriceBlockCount
  );

  const liquidationBonusRatioOk = preconditions.liquidationBonusRatio.matches(
    protocolState.liquidationBonusRatio
  );

  const oracleWhitelistHashOk = preconditions.oracleWhitelistHash.matches(
    protocolState.oracleWhitelistHash
  );

  const configMerkleRootOk = preconditions.configMerkleRoot.matches(
    protocolState.configMerkleRoot
  );

  // Combine all individual checks using logical AND:
  return emergencyStopOk
    .and(collateralRatioOk)
    .and(validPriceCountOk)
    .and(liquidationBonusRatioOk)
    .and(oracleWhitelistHashOk)
    .and(configMerkleRootOk);
}
