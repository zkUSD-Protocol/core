// // import {
//   Bool,
//   Field,
//   Poseidon,
//   Proof,
//   Provable,
//   Struct,
//   UInt32,
//   UInt8,
// } from 'o1js';
// import { BoolPrecondition, HashPrecondition, UInt8Precondition } from './preconditions.js';
// import {
//   BoolOperation,
//   FieldOperation,
//   UInt8Operation,
// } from './update-operations.js';
// import { CurrentSlot } from 'o1js/dist/node/lib/mina/precondition.js';
// import { createRollingBitSetClasses } from './rolling-bitset.js';

// export const ZKUSD_UPDATE_TREE_HEIGHT = 32;
// export const NO_RESOLUTION_INDEX = UInt32.from(4200000000);

// export const GovResolutionBufferCapacity = 15;
// export const GovResolutionShiftBufferStep = 5;
// const {
//   RollingBitSet: RollingBitSet_,
//   RollingBitSetPacked: RollingBitSetPacked_,
// } = createRollingBitSetClasses(GovResolutionBufferCapacity, GovResolutionShiftBufferStep);

// export class RollingBitSet extends RollingBitSet_ {}
// export class RollingBitSetPacked extends RollingBitSetPacked_ {}

// export class ValidityRangeUInt32 extends Struct({
//   firstValidBlock: UInt32,
//   lastValidBlock: UInt32,
// }) {}

// export class ZkusdProtocolUpdateOperation extends Struct({
//   emergencyStop: BoolOperation,
//   collateralRatio: UInt8Operation,
//   validPriceBlockCount: UInt8Operation,
//   liquidationBonusRatio: UInt8Operation,
//   oracleWhitelistHash: FieldOperation,
//   configMerkleRoot: FieldOperation,
//   newVerificationKey: FieldOperation,
//   // add more
//   fieldBitMask: Field, // --- informs which of the other fields are actually set.
// }) {
//   static emergencyStop(operation: BoolOperation): ZkusdProtocolUpdateOperation {
//     return new ZkusdProtocolUpdateOperation({
//       emergencyStop: operation,
//       collateralRatio: UInt8Operation.mkNoop(),
//       validPriceBlockCount: UInt8Operation.mkNoop(),
//       liquidationBonusRatio: UInt8Operation.mkNoop(),
//       oracleWhitelistHash: FieldOperation.mkNoop(),
//       configMerkleRoot: FieldOperation.mkNoop(),
//       newVerificationKey: FieldOperation.mkNoop(),
//       fieldBitMask: Field.from(1),
//     });
//   }

//   static collateralRatio(
//     operation: UInt8Operation
//   ): ZkusdProtocolUpdateOperation {
//     return new ZkusdProtocolUpdateOperation({
//       emergencyStop: BoolOperation.mkNoop(),
//       validPriceBlockCount: UInt8Operation.mkNoop(),
//       liquidationBonusRatio: UInt8Operation.mkNoop(),
//       oracleWhitelistHash: FieldOperation.mkNoop(),
//       configMerkleRoot: FieldOperation.mkNoop(),
//       collateralRatio: operation,
//       newVerificationKey: FieldOperation.mkNoop(),
//       fieldBitMask: Field.from(2),
//     });
//   }
// }

// export const generateNextResolutionIndexFromBitSet = (
//   rollingBitSet: RollingBitSet
// ): number => {
//   // if rolling bit set empty return zero
//   if (rollingBitSet.counter.equals(UInt32.zero).toBoolean()) {
//     return 0;
//   }
//   const highestNumberSet = rollingBitSet.getHighestNumberSetOrMinimal();
//   const nextResolutionIndex = highestNumberSet.add(1).toBigint();
//   return Number(nextResolutionIndex);
// }

// export const mkProtocolUpdateInput = (
//   protocolUpdateOperation: ZkusdProtocolUpdateOperation,
//   args: {
//     resolutionIndex?: number;
//     govResolutionNullifierBitset?: RollingBitSetPacked;
//     blockchainPreconditions?: MinaChainPreconditions;
//     protocolPreconditions?: ZkusdProtocolPreconditions;
//   }
// ): ZkusdProtocolUpdateInput => {

//   let resolutionIndex: number;

//   if (args.resolutionIndex !== undefined) {
//     resolutionIndex = args.resolutionIndex;
//   } else if (args.govResolutionNullifierBitset !== undefined) {
//     if (args.govResolutionNullifierBitset.unpack().counter.greaterThan(UInt32.zero).toBoolean()) {
//       resolutionIndex = Number(args.govResolutionNullifierBitset.unpack().getHighestNumberSetOrMinimal().add(1).toBigint());
//     } else {
//       resolutionIndex = 0;
//     }
//   } else {
//     throw new Error(
//       'Either resolutionIndex or resolutionNullifierRoot must be set'
//     );
//   }

//   const blockchainPreconditions =
//     args?.blockchainPreconditions ?? MinaChainPreconditions.always();
//   return new ZkusdProtocolUpdateInput({
//     govResolutionIndex: UInt32.from(resolutionIndex),
//     protocolUpdatePreconditions: args?.protocolPreconditions ?? {
//       emergencyStop: BoolPrecondition.mkUnconstrained(),
//       collateralRatio: UInt8Precondition.mkUnconstrained(),
//       validPriceBlockCount: UInt8Precondition.mkUnconstrained(),
//       liquidationBonusRatio: UInt8Precondition.mkUnconstrained(),
//       oracleWhitelistHash: HashPrecondition.mkUnconstrained(),
//       configMerkleRoot: HashPrecondition.mkUnconstrained(),
//       fieldBitMask: Field.from(0),
//     },
//     blockchainPreconditions,
//     protocolUpdateOperation: protocolUpdateOperation,
//   });
// };

// export class ZkusdUpdatedProtocolState extends Struct({
//   emergencyStop: Bool,
//   collateralRatio: UInt8,
//   validPriceBlockCount: UInt8,
//   liquidationBonusRatio: UInt8,
//   oracleWhitelistHash: Field,
//   configMerkleRoot: Field,

//   // add more
//   //  state stuff
//   //  totalCollateral
//   //  totalDebt
//   //  overallCollateralization
//   //  verificationKey
// }) {}

// export enum ZkusdProtocolPreconditionsIndex {
//   EMERGENCY_STOP = 0,
//   COLLATERAL_RATIO = 1,
//   VALID_PRICE_BLOCK_COUNT = 2,
//   LIQUIDATION_BONUS_RATIO = 3,
//   ORACLE_WHITELIST_HASH = 4,
//   CONFIG_MERKLE_ROOT = 5,
// }

// export class ZkusdProtocolPreconditions extends Struct({
//   emergencyStop: BoolPrecondition,
//   collateralRatio: UInt8Precondition,
//   validPriceBlockCount: UInt8Precondition,
//   liquidationBonusRatio: UInt8Precondition,
//   oracleWhitelistHash: HashPrecondition,
//   configMerkleRoot: HashPrecondition,
//   // add more
//   //  state stuff
//   //  totalCollateral
//   //  totalDebt
//   //  overallCollateralization
//   //  verificationKey - not possible ATM
//   fieldBitMask: Field, // --- informs which of the other fields are actually set.
// }) {
//   static create(args: {
//     emergencyStop?: BoolPrecondition;
//     collateralRatio?: UInt8Precondition;
//     validPriceBlockCount?: UInt8Precondition;
//     liquidationBonusRatio?: UInt8Precondition;
//     oracleWhitelistHash?: HashPrecondition;
//     configMerkleRoot?: HashPrecondition;
//     // add more
//   }): ZkusdProtocolPreconditions {
//     // build the field mask based on given args
//     let fieldBitMask = Field.from(0).toBits();
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.EMERGENCY_STOP] =
//       args.emergencyStop ? Bool(true) : Bool(false);
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.COLLATERAL_RATIO] =
//       args.collateralRatio ? Bool(true) : Bool(false);
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.VALID_PRICE_BLOCK_COUNT] =
//       args.validPriceBlockCount ? Bool(true) : Bool(false);
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.LIQUIDATION_BONUS_RATIO] =
//       args.liquidationBonusRatio ? Bool(true) : Bool(false);
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.ORACLE_WHITELIST_HASH] =
//       args.oracleWhitelistHash ? Bool(true) : Bool(false);
//     fieldBitMask[ZkusdProtocolPreconditionsIndex.CONFIG_MERKLE_ROOT] =
//       args.configMerkleRoot ? Bool(true) : Bool(false);
//     // add more

//     return new ZkusdProtocolPreconditions({
//       emergencyStop:
//         args.emergencyStop || BoolPrecondition.mkUnconstrained(),
//       collateralRatio:
//         args.collateralRatio || UInt8Precondition.mkUnconstrained(),
//       validPriceBlockCount:
//         args.validPriceBlockCount || UInt8Precondition.mkUnconstrained(),
//       liquidationBonusRatio:
//         args.liquidationBonusRatio || UInt8Precondition.mkUnconstrained(),
//       oracleWhitelistHash:
//         args.oracleWhitelistHash || HashPrecondition.mkUnconstrained(),
//       configMerkleRoot:
//         args.configMerkleRoot || HashPrecondition.mkUnconstrained(),

//       fieldBitMask: Field.fromBits(fieldBitMask),
//     });
//   }
// }

// export class MinaChainPreconditions extends Struct({
//   slotIndexValidityRange: ValidityRangeUInt32,
//   blockchainLength: ValidityRangeUInt32,
//   fieldBitMask: Field, // --- informs which of the other fields are actually set.
// }) {
//   static always(): MinaChainPreconditions {
//     return new MinaChainPreconditions({
//       slotIndexValidityRange: {
//         firstValidBlock: UInt32.from(0),
//         lastValidBlock: UInt32.from(0),
//       },
//       blockchainLength: {
//         firstValidBlock: UInt32.from(0),
//         lastValidBlock: UInt32.from(0),
//       },
//       fieldBitMask: Field.from(0), // nothing is set
//     });
//   }

//   static blockchainLength(
//     firstValidBlock?: UInt32,
//     lastValidBlock?: UInt32
//   ): MinaChainPreconditions {
//     const lower = firstValidBlock || UInt32.from(0);
//     const upper = lastValidBlock || UInt32.MAXINT();
//     return new MinaChainPreconditions({
//       slotIndexValidityRange: {
//         firstValidBlock: UInt32.from(0),
//         lastValidBlock: UInt32.from(0),
//       },
//       blockchainLength: {
//         firstValidBlock: lower,
//         lastValidBlock: upper,
//       },
//       fieldBitMask: Field.from(2), // only blockchain length is set
//     });
//   }
// }

// // current slot cannot be passed into a struct (can it?)
// export type ZkusdUpdateMinaBlockchainState = {
//   currentSlot: CurrentSlot;
//   blockchainLength: UInt32;
// };

// export class ZkusdProtocolUpdateInput extends Struct({
//   govResolutionIndex: UInt32,
//   protocolUpdatePreconditions: ZkusdProtocolPreconditions,
//   blockchainPreconditions: MinaChainPreconditions,
//   protocolUpdateOperation: ZkusdProtocolUpdateOperation,
// }) {}

// export function zkusdProtocolUpdateInputHash(
//   updateInput: ZkusdProtocolUpdateInput
// ): Field {
//   return Poseidon.hash(zkusdProtocolUpdateInputToFields(updateInput));
// }

// // The value not that important only `YesItIsAFinalZkusdProtocolUpdateProof` will be
// // accepted as the final proof.
// export const NotAFinalZkusdProtocolUpdateProof = Field.from(0);
// // Just a random enough field value that will let be certain that its usage is intentional.
// export const YesItIsAFinalZkusdProtocolUpdateProof =
//   Field.from(
//     25329768464765890060619421345429226387561522247782730071636646908705875653989n
//   );

// export class ZkusdProtocolUpdateOutput extends Struct({
//   protocolUpdateHash: Field,
//   auxilliaryOutput: Provable.Array(Field, 4),
//   isFinalProof: Field, // -- do not set it to IsFinalZkusdProtocolUpdateProof unless it is the final proof than enables the update.
// }) {}

// export class ZkusdProtocolUpdateGovContractProof extends Proof<
//   ZkusdProtocolUpdateInput,
//   ZkusdProtocolUpdateOutput
// > {
//   static publicInputType = ZkusdProtocolUpdateInput;
//   static publicOutputType = ZkusdProtocolUpdateOutput;
//   static maxProofsVerified = 2 as const;
// }

// export function theUpdatePreconditionsMatchProtocolState(args: {
//   preconditions: ZkusdProtocolPreconditions;
//   protocolState: ZkusdUpdatedProtocolState;
// }): Bool {
//   const bitMask = args.preconditions.fieldBitMask.toBits();

//   const emergencyStopMatch = args.preconditions.emergencyStop
//     .matches(args.protocolState.emergencyStop)
//     .or(bitMask[ZkusdProtocolPreconditionsIndex.EMERGENCY_STOP].not());

//   const collateralRatioMatch = args.preconditions.collateralRatio
//     .matches(args.protocolState.collateralRatio)
//     .or(bitMask[ZkusdProtocolPreconditionsIndex.COLLATERAL_RATIO].not());

//   const validPriceBlockCountMatch = args.preconditions.validPriceBlockCount
//     .matches(args.protocolState.validPriceBlockCount)
//     .or(
//       bitMask[ZkusdProtocolPreconditionsIndex.VALID_PRICE_BLOCK_COUNT].not()
//     );
//   const liquidationBonusRatioMatch = args.preconditions.liquidationBonusRatio
//     .matches(args.protocolState.liquidationBonusRatio)
//     .or(
//       bitMask[ZkusdProtocolPreconditionsIndex.LIQUIDATION_BONUS_RATIO].not()
//     );
//   const oracleWhitelistHashMatch = args.preconditions.oracleWhitelistHash
//     .matches(args.protocolState.oracleWhitelistHash)
//     .or(
//       bitMask[ZkusdProtocolPreconditionsIndex.ORACLE_WHITELIST_HASH].not()
//     );
//   const configMerkleRootMatch = args.preconditions.configMerkleRoot
//     .matches(args.protocolState.configMerkleRoot)
//     .or(bitMask[ZkusdProtocolPreconditionsIndex.CONFIG_MERKLE_ROOT].not());
//   // add more

//   const ret = emergencyStopMatch.and(
//     collateralRatioMatch.and(
//       validPriceBlockCountMatch.and(
//         liquidationBonusRatioMatch.and(
//           oracleWhitelistHashMatch.and(configMerkleRootMatch)
//         )
//       )
//     )
//   );

//   return ret;
// }

// export function requireBlockchainPreconditions(args: {
//   preconditions: MinaChainPreconditions;
//   blockchainState: ZkusdUpdateMinaBlockchainState;
// }): void {
//   const bitMask = args.preconditions.fieldBitMask.toBits();

//   const lower = Provable.if(
//     bitMask[0],
//     args.preconditions.slotIndexValidityRange.firstValidBlock,
//     UInt32.from(0)
//   );
//   const upper = Provable.if(
//     bitMask[0],
//     args.preconditions.slotIndexValidityRange.lastValidBlock,
//     UInt32.MAXINT()
//   );
//   // assert
//   args.blockchainState.currentSlot.requireBetween(lower, upper);

//   let blockChainLengthValidity =
//     args.preconditions.blockchainLength.firstValidBlock
//       .lessThanOrEqual(args.blockchainState.blockchainLength)
//       .and(
//         args.blockchainState.blockchainLength.lessThanOrEqual(
//           args.preconditions.blockchainLength.lastValidBlock
//         )
//       );
//   blockChainLengthValidity = blockChainLengthValidity.or(bitMask[1].not());

//   // assert
//   blockChainLengthValidity.assertTrue();
// }

// // --------- to fields
// export function zkusdProtocolUpdateInputToFields(
//   input: ZkusdProtocolUpdateInput
// ): Field[] {
//   const protocolUpdatePreconditionsFields = zkusdUpdatePreconditionsToFields(
//     input.protocolUpdatePreconditions
//   );
//   const blockchainPreconditionsFields = minaBlockchainPreconditionsToFields(
//     input.blockchainPreconditions
//   );
//   return [
//     ...input.govResolutionIndex.toFields(),
//     ...protocolUpdatePreconditionsFields,
//     ...blockchainPreconditionsFields,
//     ...zkusdProtocolUpdateOperationToFields(input.protocolUpdateOperation),
//   ];
// }
// export function zkusdUpdatePreconditionsToFields(
//   preconditions: ZkusdProtocolPreconditions
// ): Field[] {
//   return [preconditions.emergencyStop.value, preconditions.fieldBitMask];
// }
// export function minaBlockchainPreconditionsToFields(
//   preconditions: MinaChainPreconditions
// ): Field[] {
//   return [
//     ...preconditions.slotIndexValidityRange.firstValidBlock.toFields(),
//     ...preconditions.slotIndexValidityRange.lastValidBlock.toFields(),
//     ...preconditions.blockchainLength.firstValidBlock.toFields(),
//     ...preconditions.blockchainLength.lastValidBlock.toFields(),
//     preconditions.fieldBitMask,
//   ];
// }

// export function zkusdProtocolUpdateOperationToFields(
//   protocolUpdateOperation: ZkusdProtocolUpdateOperation
// ): Field[] {
//   return [
//     protocolUpdateOperation.emergencyStop.operation,
//     protocolUpdateOperation.fieldBitMask,
//   ];
// }
