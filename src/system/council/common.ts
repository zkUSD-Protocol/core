import { ZkusdGoverningCouncilContract } from '../../contracts/zkusd-governing-council.js';
import { Field, UInt32 } from 'o1js';

export type ZkusdGoverningCouncilEventMap =
  typeof ZkusdGoverningCouncilContract.events;

export type ContractEvent<
  K extends
    keyof ZkusdGoverningCouncilEventMap = keyof ZkusdGoverningCouncilEventMap,
> = {
  type: K;
  event: { data: InstanceType<ZkusdGoverningCouncilEventMap[K]> };
  blockHeight: UInt32;
};

export function isContractEvent<K extends keyof ZkusdGoverningCouncilEventMap>(
  e: unknown,
  type: K
): e is ContractEvent<K> {
  const ctor = ZkusdGoverningCouncilContract.events[type];
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as any).type === type &&
    (e as any).event?.data instanceof ctor &&
    (e as any).blockHeight instanceof UInt32
  );
}

/**
 * A contract-like object that can provide events.
 * Only the fields actually used in this module are required.
 */
export type HasFetchEvents = {
  fetchEvents(
    start?: UInt32,
    end?: UInt32
  ): Promise<
    Array<{
      type: string;
      event: { data: unknown };
      blockHeight: UInt32;
    }>
  >;
};

export type FetchOnchainRoot = () => Promise<Field | undefined>;

export type FetchCurrentBlockHeight = () => Promise<UInt32 | undefined>;
