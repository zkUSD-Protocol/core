import { Field, Struct, UInt32 } from 'o1js';

/**
 * Simple struct for "slotIndexValidityRange" or "blockchainLength" checks.
 * If either is unconstrained, we skip checking it.
 */
export class ValidityRangeUInt32 extends Struct({
  firstValidBlock: UInt32,
  lastValidBlock: UInt32,
}) {
  toFields(): Field[] {
    return [
      ...this.firstValidBlock.toFields(),
      ...this.lastValidBlock.toFields(),
    ];
  }
}


export class MinaChainPreconditions extends Struct({
  slotIndexValidityRange: ValidityRangeUInt32,
  blockchainLength: ValidityRangeUInt32,
  // Possibly add a boolean or separate property if you need to mark them unconstrained individually
}) {
  static always(): MinaChainPreconditions {
    // Indicate “unconstrained” by setting first=0, last=0
    // and interpret that as unconstrained, or create a dedicated sentinel property:
    return new MinaChainPreconditions({
      slotIndexValidityRange: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(UInt32.MAXINT()),
      }),
      blockchainLength: new ValidityRangeUInt32({
        firstValidBlock: UInt32.from(0),
        lastValidBlock: UInt32.from(UInt32.MAXINT()),
      }),
    });
  }

  static blockchainLength(
    firstValidBlock?: UInt32,
    lastValidBlock?: UInt32
  ): MinaChainPreconditions {

    const preconditions = MinaChainPreconditions.always();
    preconditions.blockchainLength = new ValidityRangeUInt32({
        firstValidBlock: firstValidBlock ?? UInt32.from(0),
        lastValidBlock: lastValidBlock ?? UInt32.MAXINT(),
    });
    return preconditions;
  }

  toFields(): Field[] {
    return [
      ...this.slotIndexValidityRange.toFields(),
      ...this.blockchainLength.toFields(),
    ];
  }
}
