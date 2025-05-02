import { UInt32, UInt64 } from 'o1js';
import { MinaChainPreconditions } from './blockchain-preconditions.js';

type PreconditionWithRange<T> = {
  requireBetween(lower: T, upper: T): void;
};

/**
 * Blockchain state information for a ZKUSD engine update operation.
 *
 * Represents the current slot at the time of the update.
 *
 * Properties:
 * - `slot` — `UInt32`: Current slot on the Mina blockchain.
 */
export type ZkusdUpdateMinaBlockchainState = {
  currentSlot: PreconditionWithRange<UInt32>;
};

/**
 * Provably requires the blockchain preconditions to be satisfied.
 *
 * Checks:
 * - That the `currentSlot` is within the valid slot range.
 *
 * @param args.preconditions - Expected preconditions for the slot.
 * @param args.blockchainState - Actual observed blockchain state.
 *
 * @throws Will fail the precondition if the slot is not within the valid range.
 */
export function requireBlockchainPreconditions(args: {
  preconditions: MinaChainPreconditions;
  blockchainState: ZkusdUpdateMinaBlockchainState;
}): void {
  const { slotValidityRange } = args.preconditions;
  const { currentSlot } = args.blockchainState;

  currentSlot.requireBetween(
    slotValidityRange.firstValidSlot,
    slotValidityRange.lastValidSlot
  );
}
