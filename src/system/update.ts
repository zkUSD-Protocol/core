import {
  Bool,
  Field,
  MerkleWitness,
  Poseidon,
  Proof,
  Provable,
  Struct,
  UInt32,
} from 'o1js';
import { BooleanPrecondition } from './preconditions.js';
import {
  BoolOperation,
  FieldOperation,
  UInt8Operation,
} from './update-operations.js';
import { CurrentSlot } from 'o1js/dist/node/lib/mina/precondition.js';
import { findNextResolutionIndexFromRoot } from './engine-update-witness.js';

export const ZKUSD_UPDATE_TREE_HEIGHT = 32;

export const NO_RESOLUTION_INDEX = UInt32.from(4200000000);

export const ZkusdUpdateWitness = MerkleWitness(ZKUSD_UPDATE_TREE_HEIGHT);

export class ValidityRangeUInt32 extends Struct({
  firstValidBlock: UInt32,
  lastValidBlock: UInt32,
}) {}

export class ZkusdProtocolUpdateOperation extends Struct({
  emergencyStop: BoolOperation,
  collateralRatio: UInt8Operation,
  validPriceBlockCount: UInt8Operation,
  liquidationBonusRatio: UInt8Operation,
  oracleWhitelistHash: FieldOperation,
  configMerkleRoot: FieldOperation,
  newVerificationKey: FieldOperation,
  // add more
  fieldBitMask: Field, // --- informs which of the other fields are actually set.
}) {
  static emergencyStop(operation: BoolOperation): ZkusdProtocolUpdateOperation {
    return new ZkusdProtocolUpdateOperation({
      emergencyStop: operation,
      collateralRatio: UInt8Operation.mkNoop(),
      validPriceBlockCount: UInt8Operation.mkNoop(),
      liquidationBonusRatio: UInt8Operation.mkNoop(),
      oracleWhitelistHash: FieldOperation.mkNoop(),
      configMerkleRoot: FieldOperation.mkNoop(),
      newVerificationKey: FieldOperation.mkNoop(),
      fieldBitMask: Field.from(1),
    });
  }

  static collateralRatio(
    operation: UInt8Operation
  ): ZkusdProtocolUpdateOperation {
    return new ZkusdProtocolUpdateOperation({
      emergencyStop: BoolOperation.mkNoop(),
      validPriceBlockCount: UInt8Operation.mkNoop(),
      liquidationBonusRatio: UInt8Operation.mkNoop(),
      oracleWhitelistHash: FieldOperation.mkNoop(),
      configMerkleRoot: FieldOperation.mkNoop(),
      collateralRatio: operation,
      newVerificationKey: FieldOperation.mkNoop(),
      fieldBitMask: Field.from(2),
    });
  }
}

export const mkProtocolUpdateInput = (
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
  args: {
    resolutionIndex?: number;
    resolutionNullifierRoot?: Field;
    blockchainPreconditions?: MinaBlockchainPreconditions;
    protocolPreconditions?: ZkusdUpdatePreconditions;
    // blockchainPreconditions?: MinaBlockchainPreconditions;
  }
): ZkusdProtocolUpdateInput => {
  let resolutionIndex: number;

  if (args.resolutionIndex !== undefined) {
    resolutionIndex = args.resolutionIndex;
  } else if (args.resolutionNullifierRoot !== undefined) {
    resolutionIndex = findNextResolutionIndexFromRoot(
      args.resolutionNullifierRoot
    );
  } else {
    throw new Error(
      'Either resolutionIndex or resolutionNullifierRoot must be set'
    );
  }

  const blockchainPreconditions =
    args?.blockchainPreconditions ?? MinaBlockchainPreconditions.always();
  return new ZkusdProtocolUpdateInput({
    govResolutionIndex: UInt32.from(resolutionIndex),
    protocolUpdatePreconditions: args?.protocolPreconditions ?? {
      emergencyStop: BooleanPrecondition.mkUnconstrained(),
      fieldBitMask: Field.from(0),
    },
    blockchainPreconditions,
    protocolUpdateOperation: protocolUpdateOperation,
  });
};

export class ZkusdUpdatedProtocolState extends Struct({
  emergencyStop: Bool,
  // add more
  //  state stuff
  //  totalCollateral
  //  totalDebt
  //  overallCollateralization
  //  verificationKey
}) {}

export class ZkusdUpdatePreconditions extends Struct({
  emergencyStop: BooleanPrecondition,
  // add more
  //  state stuff
  //  totalCollateral
  //  totalDebt
  //  overallCollateralization
  //  verificationKey
  fieldBitMask: Field, // --- informs which of the other fields are actually set.
}) {
  static create(args: {
    emergencyStop?: BooleanPrecondition;
  }): ZkusdUpdatePreconditions {
    // build the field mask based on given args
    let fieldBitMask = Field.from(0).toBits();
    fieldBitMask[0] = args.emergencyStop ? Bool(true) : Bool(false);
    return new ZkusdUpdatePreconditions({
      emergencyStop:
        args.emergencyStop || BooleanPrecondition.mkUnconstrained(),
      fieldBitMask: Field.fromBits(fieldBitMask),
    });
  }
}

export class MinaBlockchainPreconditions extends Struct({
  slotIndexValidityRange: ValidityRangeUInt32,
  blockchainLength: ValidityRangeUInt32,
  fieldBitMask: Field, // --- informs which of the other fields are actually set.
}) {
  static always(): MinaBlockchainPreconditions {
    return new MinaBlockchainPreconditions({
      slotIndexValidityRange: {
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(0),
      },
      blockchainLength: {
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(0),
      },
      fieldBitMask: Field.from(0), // nothing is set
    });
  }

  static blockchainLength(
    firstValidBlock?: UInt32,
    lastValidBlock?: UInt32
  ): MinaBlockchainPreconditions {
    const lower = firstValidBlock || UInt32.from(0);
    const upper = lastValidBlock || UInt32.MAXINT();
    return new MinaBlockchainPreconditions({
      slotIndexValidityRange: {
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(0),
      },
      blockchainLength: {
        firstValidBlock: lower,
        lastValidBlock: upper,
      },
      fieldBitMask: Field.from(2), // only blockchain length is set
    });
  }
}

// current slot cannot be passed into a struct (can it?)
export type ZkusdUpdateMinaBlockchainState = {
  currentSlot: CurrentSlot;
  blockchainLength: UInt32;
};

export class ZkusdProtocolUpdateInput extends Struct({
  govResolutionIndex: UInt32,
  protocolUpdatePreconditions: ZkusdUpdatePreconditions,
  blockchainPreconditions: MinaBlockchainPreconditions,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
}) {}

export function zkusdProtocolUpdateInputHash(
  updateInput: ZkusdProtocolUpdateInput
): Field {
  return Poseidon.hash(zkusdProtocolUpdateInputToFields(updateInput));
}

// The value not that important only `YesItIsAFinalZkusdProtocolUpdateProof` will be
// accepted as the final proof.
export const NotAFinalZkusdProtocolUpdateProof = Field.from(0);
// Just a random enough field value that will let be certain that its usage is intentional.
export const YesItIsAFinalZkusdProtocolUpdateProof =
  Field.from(
    25329768464765890060619421345429226387561522247782730071636646908705875653989n
  );

export class ZkusdProtocolUpdateOutput extends Struct({
  protocolUpdateHash: Field,
  auxilliaryOutput: Provable.Array(Field, 4),
  isFinalProof: Field, // -- do not set it to IsFinalZkusdProtocolUpdateProof unless it is the final proof than enables the update.
}) {}

export class ZkusdProtocolUpdateGovContractProof extends Proof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
}

export function theUpdatePreconditionsMatchProtocolState(args: {
  preconditions: ZkusdUpdatePreconditions;
  protocolState: ZkusdUpdatedProtocolState;
}): Bool {
  const bitMask = args.preconditions.fieldBitMask.toBits();
  const hasEmergencyStopPrecondition = bitMask[0];

  const emergencyStopMatch = args.preconditions.emergencyStop
    .matches(args.protocolState.emergencyStop)
    .or(hasEmergencyStopPrecondition.not());
  return emergencyStopMatch;
}

export function requireBlockchainPreconditions(args: {
  preconditions: MinaBlockchainPreconditions;
  blockchainState: ZkusdUpdateMinaBlockchainState;
}): void {
  const bitMask = args.preconditions.fieldBitMask.toBits();

  const lower = Provable.if(
    bitMask[0],
    args.preconditions.slotIndexValidityRange.firstValidBlock,
    UInt32.from(0)
  );
  const upper = Provable.if(
    bitMask[0],
    args.preconditions.slotIndexValidityRange.lastValidBlock,
    UInt32.MAXINT()
  );
  // assert
  args.blockchainState.currentSlot.requireBetween(lower, upper);

  let blockChainLengthValidity =
    args.preconditions.blockchainLength.firstValidBlock
      .lessThanOrEqual(args.blockchainState.blockchainLength)
      .and(
        args.blockchainState.blockchainLength.lessThanOrEqual(
          args.preconditions.blockchainLength.lastValidBlock
        )
      );
  blockChainLengthValidity = blockChainLengthValidity.or(bitMask[1].not());

  // assert
  blockChainLengthValidity.assertTrue();
}

// --------- to fields
export function zkusdProtocolUpdateInputToFields(
  input: ZkusdProtocolUpdateInput
): Field[] {
  const protocolUpdatePreconditionsFields = zkusdUpdatePreconditionsToFields(
    input.protocolUpdatePreconditions
  );
  const blockchainPreconditionsFields = minaBlockchainPreconditionsToFields(
    input.blockchainPreconditions
  );
  return [
    ...input.govResolutionIndex.toFields(),
    ...protocolUpdatePreconditionsFields,
    ...blockchainPreconditionsFields,
    ...zkusdProtocolUpdateOperationToFields(input.protocolUpdateOperation),
  ];
}
export function zkusdUpdatePreconditionsToFields(
  preconditions: ZkusdUpdatePreconditions
): Field[] {
  return [preconditions.emergencyStop.value, preconditions.fieldBitMask];
}
export function minaBlockchainPreconditionsToFields(
  preconditions: MinaBlockchainPreconditions
): Field[] {
  return [
    ...preconditions.slotIndexValidityRange.firstValidBlock.toFields(),
    ...preconditions.slotIndexValidityRange.lastValidBlock.toFields(),
    ...preconditions.blockchainLength.firstValidBlock.toFields(),
    ...preconditions.blockchainLength.lastValidBlock.toFields(),
    preconditions.fieldBitMask,
  ];
}

export function zkusdProtocolUpdateOperationToFields(
  protocolUpdateOperation: ZkusdProtocolUpdateOperation
): Field[] {
  return [
    protocolUpdateOperation.emergencyStop.operation,
    protocolUpdateOperation.fieldBitMask,
  ];
}
