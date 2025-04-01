import { Field, UInt32 } from "o1js";
import { MinaBlockchainPreconditions, ZkusdProtocolUpdateInput, ZkusdUpdatePreconditions } from "../../../system/update.js";
import { BooleanPrecondition } from "../../../system/preconditions.js";
import { BoolOperation, UInt8Operation } from "../../../system/update-operations.js";


export const toggleEmergencyStop = (
  args?: {
    emergencyStopOperation?: BoolOperation;
    minimumAcceptedChainLength?: number;
    maximumAcceptedChainLength?: number;
  }
) => {
  // to uint32 if present
  const lower = args?.minimumAcceptedChainLength ? UInt32.from(args.minimumAcceptedChainLength) : undefined;
  const upper = args?.maximumAcceptedChainLength ? UInt32.from(args.maximumAcceptedChainLength) : undefined;

  return updateProtocolEmergencyStop({
    emergencyStopOperation: BoolOperation.mkFlip(),
    blockchainPreconditions: MinaBlockchainPreconditions.blockchainLength(
      lower,
      upper
    ),
  });
};

export const updateProtocolEmergencyStop = (
  args: {
    emergencyStopOperation: BoolOperation;
    blockchainPreconditions?: MinaBlockchainPreconditions;
    protocolPreconditions?: ZkusdUpdatePreconditions;
    // blockchainPreconditions?: MinaBlockchainPreconditions;
  }
): ZkusdProtocolUpdateInput => {

  const blockchainPreconditions = args.blockchainPreconditions ?? MinaBlockchainPreconditions.always();
  return new ZkusdProtocolUpdateInput({
    govResolutionIndex: UInt32.from(0),
    protocolUpdatePreconditions: args.protocolPreconditions ?? {
      emergencyStop: BooleanPrecondition.mkUnconstrained(),
      fieldBitMask: Field.from(0),
    },
    blockchainPreconditions,
    protocolUpdateOperation: {
      collateralRatio: UInt8Operation.mkNoop(),
      emergencyStop: args.emergencyStopOperation,
      validPriceBlockCount: UInt8Operation.mkNoop(),
      liquidationBonusRatio: UInt8Operation.mkNoop(),
      fieldBitMask: Field.from(1),
    },
  });
};

export const createSampleUpdateInput = (
): ZkusdProtocolUpdateInput => {
  return new ZkusdProtocolUpdateInput({
    govResolutionIndex: UInt32.from(0),
    protocolUpdatePreconditions: {
      emergencyStop: BooleanPrecondition.mkUnconstrained(),
      fieldBitMask: Field.from(0),
    },
    blockchainPreconditions: {
      slotIndexValidityRange: {
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(0),
      },
      blockchainLength: {
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(0),
      },
      fieldBitMask: Field.from(0),
    },
    protocolUpdateOperation: {
      collateralRatio: UInt8Operation.mkNoop(),
      validPriceBlockCount: UInt8Operation.mkNoop(),
      liquidationBonusRatio: UInt8Operation.mkNoop(),
      emergencyStop: BoolOperation.mkFlip(),
      fieldBitMask: Field.from(1),
    },
  });
};
