import { UInt32 } from "o1js";
import { CurrentSlot } from "o1js/dist/node/lib/mina/precondition";
import { MinaChainPreconditions } from "./blockchain-preconditions.js";

// current slot cannot be passed into a struct (can it?)
export type ZkusdUpdateMinaBlockchainState = {
  currentSlot: CurrentSlot;
  blockchainLength: UInt32;
};


/**
 * Provably:
 * Checks slotIndexValidityRange if it's not "unconstrained".
 * Checks blockchainLength if it's not "unconstrained".
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
