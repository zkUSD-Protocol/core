/*****************************************************************************************
 *  system/update/simple-preconditions.ts
 *
 *  Compact helpers to express protocol‑update pre‑conditions.
 *
 *  ──────────────────────────────────────────────────────────────────────────────
 *  ‣ HashPrecondition   – equality / inequality on Field hashes
 *  ‣ BoolPrecondition   – true / false / unconstrained
 *  ‣ createRangePrecondition<T>() – generic factory used for
 *            • FieldPrecondition   (full‑width Field arithmetic)
 *            • UInt8Precondition
 *            • UInt32Precondition
 *            • UInt64Precondition
 *
 *  All *Range* preconditions share the same API:
 *      .equal(x)           .differentThan(x)   .greaterOrEqual(x)
 *      .lessOrEqual(x)     .unconstrained()
 *      .matches(value)   // returns o1js.Bool
 *****************************************************************************************/

import {
  Bool,
  Field,
  Provable,
  Struct,
  UInt8,
  UInt32,
  UInt64,
} from 'o1js';

/* -------------------------------------------------------------------------- */
/*                Generic factory for Field / UInt‑range preconditions        */
/* -------------------------------------------------------------------------- */

/**
 * Create a Struct‑based numeric precondition class for any o1js *scalar type*
 * that supports:
 *   • static from()          • .add(), .sub()
 *   • .greaterThanOrEqual()  • .lessThanOrEqual()
 *
 * @param Scalar      – the constructor (Field, UInt8, UInt32, UInt64…)
 * @param maxValue    – inclusive upper bound for `.unconstrained()` helpers
 * @param serialize   – maps {lower, upper, not} → Field[3] for toFields()
 */
function createRangePrecondition(
  Scalar: any,
  maxValue: any,
  serialize: (lower: any, upper: any, not: Bool) => Field[],
) {
  return class RangePrecondition extends Struct({
    lower: Scalar,
    upper: Scalar,
    not: Bool,
  }) {
    matches(value: any): Bool {
      const inRange = value
        .greaterThanOrEqual(this.lower)
        .and(value.lessThanOrEqual(this.upper));

      return Provable.if(this.not, inRange.not(), inRange);
    }

    static greaterOrEqual(v: any): RangePrecondition {
      return new this({
        lower: Scalar.from(v),
        upper: maxValue,
        not: Bool(false),
      });
    }

    static lessOrEqual(v: any): RangePrecondition {
      return new this({
        lower: Scalar.from(0),
        upper: Scalar.from(v),
        not: Bool(false),
      });
    }

    static equal(v: any): RangePrecondition {
      const vv = Scalar.from(v);
      return new this({
        lower: vv,
        upper: vv,
        not: Bool(false),
      });
    }

    static differentThan(v: any): RangePrecondition {
      const vv = Scalar.from(v);
      return new this({
        lower: vv,
        upper: vv,
        not: Bool(true),
      });
    }

    static unconstrained(): RangePrecondition {
      return new this({
        lower: Scalar.from(0),
        upper: maxValue,
        not: Bool(false),
      });
    }

    toFields(): Field[] {
      return serialize(this.lower, this.upper, this.not);
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                   Concrete instantiations of the generic factory           */
/* -------------------------------------------------------------------------- */

/** Field‑wide max (Field.ORDER − 1). */
const FieldMax = Field.from(Field.ORDER - 1n);

export const UInt8Precondition = createRangePrecondition(
  UInt8,
  UInt8.MAXINT(),
  (lower: UInt8, upper: UInt8, not: Bool) => [lower.value, upper.value, not.toField()],
);

export const UInt32Precondition = createRangePrecondition(
  UInt32,
  UInt32.MAXINT(),
  (lower: UInt32, upper: UInt32, not: Bool) => [lower.value, upper.value, not.toField()],
);

export const UInt64Precondition = createRangePrecondition(
  UInt64,
  UInt64.MAXINT(),
  (lower: UInt64, upper: UInt64, not: Bool) => [lower.value, upper.value, not.toField()],
);

export const FieldPrecondition = createRangePrecondition(
  Field,
  FieldMax,
  (lower: Field, upper: Field, not: Bool) => [lower, upper, not.toField()],
);

export type UInt8Precondition = InstanceType<typeof UInt8Precondition>;

export type UInt32Precondition = InstanceType<typeof UInt32Precondition>;

export type UInt64Precondition = InstanceType<typeof UInt64Precondition>;

export type FieldPrecondition = InstanceType<typeof FieldPrecondition>;

/* -------------------------------------------------------------------------- */
/*                              Hash precondition                             */
/* -------------------------------------------------------------------------- */

export class HashPrecondition extends Struct({
  state: Field,
  not: Field, // 0 = equal, 1 = not‑equal, 2 = unconstrained
}) {
  matches(value: Field): Bool {
    const eq = value.equals(this.state);
    const neq = eq.not();
    const any = Bool(true);

    // 0 → eq, 1 → neq, 2 → any
    return Provable.if(
      this.not.equals(Field.from(0)), eq,
      Provable.if(this.not.equals(Field.from(1)), neq, any),
    );
  }

  static equal(v: Field | number | bigint) {
    return new HashPrecondition({ state: Field.from(v), not: Field.from(0) });
  }
  static differentThan(v: Field | number | bigint) {
    return new HashPrecondition({ state: Field.from(v), not: Field.from(1) });
  }
  static unconstrained() {
    return new HashPrecondition({ state: Field.from(0), not: Field.from(2) });
  }

  toFields(): Field[] {
    return [this.state, this.not];
  }
}

/* -------------------------------------------------------------------------- */
/*                              Bool precondition                             */
/* -------------------------------------------------------------------------- */

export class BoolPrecondition extends Struct({
  value: Field, // 0 = false, 1 = true, 2 = unconstrained
}) {
  private expectFalse(): Bool { return this.value.equals(Field.from(0)); }
  private expectTrue(): Bool { return this.value.equals(Field.from(1)); }
  private free(): Bool { return this.value.equals(Field.from(2)); }

  matches(v: Bool): Bool {
    return this.free()
      .or(this.expectTrue().and(v))
      .or(this.expectFalse().and(v.not()));
  }

  static equal(v: Bool | boolean) {
    return new BoolPrecondition({
      value: Field.from(Bool(v).toBoolean() ? 1 : 0),
    });
  }
  static unconstrained() {
    return new BoolPrecondition({ value: Field.from(2) });
  }

  toFields(): Field[] {
    return [this.value];
  }
}
