// import { Bool, Field, Provable, Struct, UInt8 } from 'o1js'; // or your zk library

// // Define the max valid Field value: Field.ORDER - 1
// const FieldMax = Field.from(Field.ORDER - 1n);
// const UInt8Max = UInt8.from(255);

// export class HashPrecondition extends Struct({
//   state: Field,
//   not: Field, // - 2 unconstrained, 1 - equality negated, 0 -  normal equality
// }) {
//   matches(value: Field): Bool {

//     const equalityCheck = value.equals(this.state);
//     const nonEqualityCheck = equalityCheck.not();
//     const unconstrainedCheck = Bool(true);

//     const ret = Provable.if(
//       this.not.equals(Field.from(0)),
//       equalityCheck,
//       Provable.if(
//         this.not.equals(Field.from(1)),
//         nonEqualityCheck,
//         unconstrainedCheck,
//       ),
//     );

//     return ret;
//   }

//   static mkEqual(value: Field) {
//     return new HashPrecondition({
//       state: value,
//       not: Field.from(0),
//     });
//   }

//   static mkDifferentThan(value: Field) {
//     return new HashPrecondition({
//       state: value,
//       not: Field.from(1),
//     });
//   }

//   static mkUnconstrained() {
//     return new HashPrecondition({
//       state: Field.from(0),
//       not: Field.from(2),
//     });
//   }
// }

// export class FieldPrecondition extends Struct({
//   lower: Field,
//   upper: Field,
//   not: Bool,
// }) {
//   matches(value: Field): Bool {
//     const greaterOrEqualLower = value.greaterThanOrEqual(this.lower);
//     const lessOrEqualUpper = value.lessThanOrEqual(this.upper);
//     const rangeCheck = greaterOrEqualLower.and(lessOrEqualUpper);
//     const ret = Provable.if(this.not, rangeCheck.not(), rangeCheck);
//     return ret;
//   }


//   static mkEqual(value: Field) {
//     return new FieldPrecondition({
//       lower: value,
//       upper: value,
//       not: Bool(false),
//     });
//   }

//   static mkDifferentThan(value: Field) {
//     return new FieldPrecondition({
//       lower: value,
//       upper: value,
//       not: Bool(true),
//     });
//   }

//   static mkGreater(value: Field) {
//     return new FieldPrecondition({
//       lower: value.add(1),
//       upper: FieldMax,
//       not: Bool(true),
//     });
//   }

//   static mkGreaterOrEqual(value: Field) {
//     return new FieldPrecondition({
//       lower: value,
//       upper: FieldMax,
//       not: Bool(true),
//     });
//   }

//   static mkLess(value: Field) {
//     return new FieldPrecondition({
//       lower: Field.from(0),
//       upper: value.sub(1),
//       not: Bool(true),
//     });
//   }

//   static mkLessOrEqual(value: Field) {
//     return new FieldPrecondition({
//       lower: Field.from(0),
//       upper: value,
//       not: Bool(false),
//     });
//   }

//   static mkUnconstrained() {
//     return new FieldPrecondition({
//       lower: Field.from(0),
//       upper: FieldMax,
//       not: Bool(false),
//     });
//   }
// }

// export class BoolPrecondition extends Struct({
//   value: Field,
// }) {
//   requireFalse() {
//     return this.value.equals(Field.from(0));
//   }

//   requireTrue() {
//     return this.value.equals(Field.from(1));
//   }

//   unconstrained() {
//     return this.value.equals(Field.from(2));
//   }

//   matches(value: Bool) {
//     return this.unconstrained()
//       .or(this.requireTrue().and(value))
//       .or(this.requireFalse().and(value.not()));
//   }

//   static mkMustEqual(value: boolean) {
//     return new BoolPrecondition({ value: Field.from(value ? 1 : 0) });
//   }

//   static mkUnconstrained() {
//     return new BoolPrecondition({ value: Field.from(2) });
//   }
// }

// export class UInt8Precondition extends Struct({
//   lower: UInt8,
//   upper: UInt8,
//   not: Bool,
// }) {
//   matches(value: UInt8): Bool {
//     const greaterOrEqualLower = value.greaterThanOrEqual(this.lower);
//     const lessOrEqualUpper = value.lessThanOrEqual(this.upper);
//     const rangeCheck = greaterOrEqualLower.and(lessOrEqualUpper);
//     const ret = Provable.if(this.not, rangeCheck.not(), rangeCheck);
//     return ret;
//   }

//   static mkEqual(value: UInt8) {
//     return new UInt8Precondition({
//       lower: value,
//       upper: value,
//       not: Bool(false),
//     });
//   }

//   static mkDifferentThan(value: UInt8) {
//     return new UInt8Precondition({
//       lower: value,
//       upper: value,
//       not: Bool(true),
//     });
//   }

//   static mkGreater(value: UInt8) {
//     return new UInt8Precondition({
//       lower: value.add(1),
//       upper: UInt8Max,
//       not: Bool(true),
//     });
//   }

//   static mkGreaterOrEqual(value: UInt8) {
//     return new UInt8Precondition({
//       lower: value,
//       upper: UInt8Max,
//       not: Bool(true),
//     });
//   }

//   static mkLess(value: UInt8) {
//     return new UInt8Precondition({
//       lower: UInt8.from(0),
//       upper: value.sub(1),
//       not: Bool(true),
//     });
//   }

//   static mkLessOrEqual(value: UInt8) {
//     return new UInt8Precondition({
//       lower: UInt8.from(0),
//       upper: value,
//       not: Bool(false),
//     });
//   }

//   static mkUnconstrained() {
//     return new UInt8Precondition({
//       lower: UInt8.from(0),
//       upper: UInt8Max,
//       not: Bool(false),
//     });
//   }
// }
