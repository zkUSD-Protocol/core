import { Bool, UInt8, Field, Struct } from 'o1js';
import { ZkusdProtocolPreconditions } from './protocol-preconditions.js';

/**
 * Represents the on-chain state of the protocol, which we may compare
 * against the preconditions.
 */
export class ZkusdUpdatedProtocolState extends Struct({
  emergencyStop: Bool,
  collateralRatio: UInt8,
  validPriceBlockCount: UInt8,
  liquidationBonusRatio: UInt8,
  oracleWhitelistHash: Field,
  configMerkleRoot: Field,
  // add more if needed...
}) {

  isValidForPreconditions(preconditions: ZkusdProtocolPreconditions): Bool {
    // Check if the protocol state matches the preconditions:
    return theUpdatePreconditionsMatchProtocolState({
      preconditions,
      protocolState: this,
    });
  }
}

function theUpdatePreconditionsMatchProtocolState(args: {
  preconditions: ZkusdProtocolPreconditions;
  protocolState: ZkusdUpdatedProtocolState;
}): Bool {
  // For each field, check if it's unconstrained or if it matches:
  const { preconditions, protocolState } = args;

  const emergencyStopOk = preconditions.emergencyStop
    .matches(protocolState.emergencyStop);

  const collateralRatioOk = preconditions.collateralRatio
    .matches(protocolState.collateralRatio);

  const validPriceCountOk = preconditions.validPriceBlockCount
    .matches(protocolState.validPriceBlockCount);

  const liquidationBonusRatioOk = preconditions.liquidationBonusRatio
    .matches(protocolState.liquidationBonusRatio);

  const oracleWhitelistHashOk = preconditions.oracleWhitelistHash
    .matches(protocolState.oracleWhitelistHash);

  const configMerkleRootOk = preconditions.configMerkleRoot
    .matches(protocolState.configMerkleRoot);

  // Combine them all with logical AND:
  return emergencyStopOk
    .and(collateralRatioOk)
    .and(validPriceCountOk)
    .and(liquidationBonusRatioOk)
    .and(oracleWhitelistHashOk)
    .and(configMerkleRootOk);
}
