import { Bool, DynamicProof, Field, MerkleWitness, Proof, Provable, Struct, UInt32 } from 'o1js';
import { BooleanPrecondition } from './preconditions.js';
import { BoolOperation } from './update-operations.js';

export const ZKUSD_UPDATE_TREE_HEIGHT = 32;

export const NO_RESOLUTION_INDEX = UInt32.from(4200000000);

export const ZkusdUpdateWitness = MerkleWitness(ZKUSD_UPDATE_TREE_HEIGHT);


export class ValidityRangeUInt32 extends Struct({
  firstValidBlock: UInt32,
  lastValidBlock: UInt32,
}) {}

export class ZkusdProtocolUpdateOperation extends Struct({
  emergencyStop: BoolOperation,
  // add more
  fieldBitMask: Field, // --- informs which of the other fields are actually set.
}) {}

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
}) {}

export class MinaBlockchainPreconditions extends Struct({
  slotIndexValidityRange: ValidityRangeUInt32,
  blockchainLength: ValidityRangeUInt32,
  fieldBitMask: Field, // --- informs which of the other fields are actually set.
}) {}

export class ZkusdUpdateMinaBlockchainState extends Struct({
  slotIndex: UInt32,
  blockchainLength: UInt32,
}) {}

export class ZkusdProtocolUpdateInput extends Struct({
  govResolutionIndex: UInt32,
  protocolUpdatePreconditions: ZkusdUpdatePreconditions,
  blockchainPreconditions: MinaBlockchainPreconditions,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
}) {}

export const NotAFinalZkusdProtocolUpdateProof = Field.from(0);
export const YesItIsAFinalZkusdProtocolUpdateProof = Field.from(25329768464765890060619421345429226387561522247782730071636646908705875653989n);

export class ZkusdProtocolUpdateOutput extends Struct({
  protocolUpdateHash: Field,
  auxilliaryOutput: Provable.Array(Field, 4),
  isFinalProof: Field, // -- do not set it to IsFinalZkusdProtocolUpdateProof unless it is the final proof than enables the update.
}) {
}


export class ZkusdProtocolUpdateProof extends DynamicProof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
}

export class ZkusdProtocolUpdateGovContractProof extends Proof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
}

export function theUpdatePreconditionsMatchProtocolState(args:
  {
    preconditions: ZkusdUpdatePreconditions
    protocolStatus: ZkusdUpdatedProtocolState,
  }): Bool {
  return args.preconditions.emergencyStop.matches(args.protocolStatus.emergencyStop);
}

export function theUpdatePreconditionsMatchMinaBlockchainState(args:
  {
    preconditions: MinaBlockchainPreconditions,
    blockchainState: ZkusdUpdateMinaBlockchainState,
  }): Bool {
  return args.preconditions.slotIndexValidityRange.firstValidBlock.lessThanOrEqual(args.blockchainState.slotIndex)
    .and(args.blockchainState.slotIndex.lessThanOrEqual(args.preconditions.slotIndexValidityRange.lastValidBlock))
    .and(args.preconditions.blockchainLength.firstValidBlock.lessThanOrEqual(args.blockchainState.blockchainLength))
    .and(args.blockchainState.blockchainLength.lessThanOrEqual(args.preconditions.blockchainLength.lastValidBlock));
}

// --------- to fields
export function zkusdProtocolUpdateInputToFields(input: ZkusdProtocolUpdateInput): Field[] {
  const protocolUpdatePreconditionsFields = zkusdUpdatePreconditionsToFields(input.protocolUpdatePreconditions);
  const blockchainPreconditionsFields = minaBlockchainPreconditionsToFields(input.blockchainPreconditions);
  return [
    ...input.govResolutionIndex.toFields(),
    ...protocolUpdatePreconditionsFields,
    ...blockchainPreconditionsFields,
    ...zkusdProtocolUpdateOperationToFields(input.protocolUpdateOperation),
  ];
}
export function zkusdUpdatePreconditionsToFields(preconditions: ZkusdUpdatePreconditions): Field[] {
  return [
    preconditions.emergencyStop.value,
    preconditions.fieldBitMask,
  ];
}
export function minaBlockchainPreconditionsToFields(preconditions: MinaBlockchainPreconditions): Field[] {
  return [
    ...preconditions.slotIndexValidityRange.firstValidBlock.toFields(),
    ...preconditions.slotIndexValidityRange.lastValidBlock.toFields(),
    ...preconditions.blockchainLength.firstValidBlock.toFields(),
    ...preconditions.blockchainLength.lastValidBlock.toFields(),
    preconditions.fieldBitMask,
  ];
}

export function zkusdProtocolUpdateOperationToFields(protocolUpdateOperation: ZkusdProtocolUpdateOperation): Field[] {
  return [
    protocolUpdateOperation.emergencyStop.operation,
    protocolUpdateOperation.fieldBitMask,
  ];
}
