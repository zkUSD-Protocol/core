import { Bool, Field, Struct } from 'o1js'; // or your zk library

// Define the max valid Field value: Field.ORDER - 1
const FieldMax = Field.from(Field.ORDER - 1n);

export class FieldPrecondition extends Struct({
  lower: Field,
  upper: Field
}) {

  matches(value: Field): Bool {
    const greaterOrEqualLower = value.greaterThanOrEqual(this.lower);
    const lessOrEqualUpper = value.lessThanOrEqual(this.upper);
    return greaterOrEqualLower.and(lessOrEqualUpper);
  }

  static mkEqual(value: Field) {
    return new FieldPrecondition({
      lower: value,
      upper: value
    });
  }

  static mkGreater(value: Field) {
    return new FieldPrecondition({
      lower: value.add(1),
      upper: FieldMax
    });
  }

  static mkGreaterOrEqual(value: Field) {
    return new FieldPrecondition({
      lower: value,
      upper: FieldMax
    });
  }

  static mkLess(value: Field) {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: value.sub(1)
    });
  }

  static mkLessOrEqual(value: Field) {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: value
    });
  }

  static mkUnconstrained() {
    return new FieldPrecondition({
      lower: Field.from(0),
      upper: FieldMax
    });
  }
}

export class BooleanPrecondition extends Struct({
  value: Field
}) {

  requireFalse() {
    return this.value.equals(Field.from(0));
  }

  requireTrue() {
    return this.value.equals(Field.from(1));
  }

  unconstrained() {
    return this.value.equals(Field.from(2));
  }

  matches(value: Bool) {
    return this.unconstrained()
      .or(this.requireTrue().and(value))
      .or(this.requireFalse().and(value.not()));
  }

  static mkMustEqual(value: boolean) {
    return new BooleanPrecondition({ value: Field.from(value ? 1 : 0) });
  }

  static mkUnconstrained() {
    return new BooleanPrecondition({ value: Field.from(2) });
  }
}
