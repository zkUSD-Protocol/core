import { UInt32 } from 'o1js';
import { CurrentSlot } from 'o1js/dist/node/lib/mina/precondition';
import { MinaChainPreconditions } from './blockchain-preconditions.js';

/**
 * Blockchain state information for a ZKUSD engine update operation.
 *
 * Represents the current slot and blockchain length at the time of the update.
 *
 * Properties:
 * - `currentSlot` — `CurrentSlot`: Current slot number on the Mina blockchain.
 * - `blockchainLength` — `UInt32`: Current blockchain length.
 */
export type ZkusdUpdateMinaBlockchainState = {
  currentSlot: CurrentSlot;
  blockchainLength: UInt32;
};

/**
 * Provably requires the blockchain preconditions to be satisfied.
 *
 * Checks:
 * - That the `currentSlot` is within the valid slot index range.
 * - That the `blockchainLength` is within the allowed block length range.
 *
 * @param args.preconditions - Expected preconditions for the slot index and blockchain length.
 * @param args.blockchainState - Actual observed blockchain state.
 *
 * @throws Will assert failure if any of the conditions are not satisfied.
 */
export function requireBlockchainPreconditions(args: {
  preconditions: MinaChainPreconditions;
  blockchainState: ZkusdUpdateMinaBlockchainState;
}): void {
  const { slotIndexValidityRange, blockchainLength } = args.preconditions;
  const { currentSlot, blockchainLength: chainLength } = args.blockchainState;

  currentSlot.requireBetween(
    slotIndexValidityRange.firstValidBlock,
    slotIndexValidityRange.lastValidBlock
  );

  const inRange = blockchainLength.firstValidBlock
    .lessThanOrEqual(chainLength)
    .and(chainLength.lessThanOrEqual(blockchainLength.lastValidBlock));

  inRange.assertTrue();
}
