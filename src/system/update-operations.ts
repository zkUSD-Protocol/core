
import { Bool, Field, Provable, Struct } from 'o1js'; // or your zk library

// Define the max valid Field value: Field.ORDER - 1
const FieldMax = Field.from(Field.ORDER - 1n);

interface UpdateOperation<T> {
  execute: (state: T) => T;
}

export class BoolOperation extends Struct({
  operation: Field
}) implements UpdateOperation<Bool> {
  execute(state: Bool): Bool {
    const isSet: Bool = this.operation.lessThan(2);
    const value: Bool = Provable.if(this.operation.equals(0), Bool(false), Bool(true));

    const isFlip: Bool = this.operation.equals(2);
    const flipped: Bool = state.not();

    const isNoop: Bool = this.operation.equals(3);

    return Provable.if(isSet, value, Provable.if(isFlip, flipped, state));
  }

  static mkSetTo(value: Bool) {
    return new BoolOperation({
      operation: Field.fromBits([value])
    });
  }

  static mkFlip() {
    return new BoolOperation({
      operation: Field.from(2)
    });
  }

  static mkNoop(value: Bool) {
    return new BoolOperation({
      operation: Field.from(3)
    });
  }
}
