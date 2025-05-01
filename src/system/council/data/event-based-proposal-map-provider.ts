import { Provable, UInt32 } from 'o1js';
import { IMerkleDataProvider } from '../data/imerkle-data-provider.js';
import {
  ContractEvent,
  FetchCurrentBlockHeight,
  FetchOnchainRoot,
  HasFetchEvents,
  isContractEvent,
} from '../common.js';
import { ProposalMap } from '../data/proposal-merkle-map.js';
import { ZkusdGoverningCouncilContract } from '../../../contracts/zkusd-governing-council.js';

/**
 * A runtime-narrowed `ProposalSupported` event with the expected structure.
 */
type ProposalSupportedEvent = ContractEvent<'ProposalSupported'>;

/**
 * Runtime check to validate that an event is a `ProposalSupported` event
 * with the correct structure.
 */
function isProposalSupportedEvent(e: unknown): e is ProposalSupportedEvent {
  return isContractEvent(e, 'ProposalSupported');
}
/* -------------------------------------------------------------------------- */
/*                     Contract Event-Based ResolutionTree Provider                    */
/* -------------------------------------------------------------------------- */

/**
 * A Merkle data provider that reconstructs a `ProposalMap`
 * from on-chain `ProposalSupported` events, streamed in chunks.
 *
 * The tree is cached internally and lazily updated. If the existing
 * tree’s root matches an incoming event’s `proposalMapBefore`,
 * only newer events are replayed.
 */
export class ProposalMapContractEventsProvider
  implements IMerkleDataProvider<ProposalMap>
{
  private proposalMap: ProposalMap;

  /**
   * @param source - Any object with a `fetchEvents()` method.
   * @param chunkSize - Number of block heights to fetch per request (default 1000).
   */
  constructor(
    private readonly source: HasFetchEvents,
    private readonly fetchOnchainRoot: FetchOnchainRoot,
    private readonly fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    private readonly chunkSize = 1000
  ) {}

  static fromContract(
    councilContract: ZkusdGoverningCouncilContract,
    fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    chunkSize = 1000
  ): ProposalMapContractEventsProvider {
    return new ProposalMapContractEventsProvider(
      councilContract,
      () => councilContract.proposalsMerkleMapRoot.fetch(),
      fetchCurrentBlockHeight,
      chunkSize
    );
  }

  /**
   * Returns the cached `ResolutionTree`, loading it on first access.
   */
  async get(): Promise<ProposalMap> {
    // try refresh if not yet built or does not match the onchain
    if (!this.proposalMap || !(await this.matchesOnchainRoot())) {
      await this.refresh();
      if (!(await this.matchesOnchainRoot())) {
        // even after refreshing it is not matching - bail out.
        throw new Error(
          'The data does not match the onchain state even after refreshing.'
        );
      }
    }
    return this.proposalMap!;
  }

  async matchesOnchainRoot(): Promise<boolean> {
    const currentRoot = this.proposalMap?.getRoot();
    if (!currentRoot) {
      throw new Error(
        'Cannot check if council map is stale: no root available.'
      );
    }
    const onchainRoot = await this.fetchOnchainRoot();
    if (!onchainRoot) {
      throw new Error('Cannot fetch proposal map root from the chain.');
    }
    return onchainRoot.equals(currentRoot).toBoolean();
  }

  /**
   * Rebuilds or updates the tree by scanning `ProposalPassed` events
   * backwards in fixed-size chunks until:
   *  - a matching previous root is found, or
   *  - genesis is reached.
   *  The assumption is that events are fetched from newest to oldest
   */
  // TODO for now naively fetches all the events and rebuilds entire map.
  async refresh(): Promise<void> {
    const events = await this.source.fetchEvents();
    this.proposalMap =
      ProposalMapContractEventsProvider.rebuildProposalMap(events);

    // // get the latest chunk (ordered from newest to latest)
    // // search for sync point, if found them discard all previous events
    // // if not found it probably means that these events are to be applied yet
    // // but proceed in searching in the previous chunk
    // // when finally found then apply all the not discarded events from all the chunks
    // // processed
    // // if reached genesis without sync point then throw an error

    // const toApply: ProposalSupportedEvent[] = [];
    // let foundSyncPoint = false
    // const cachedRoot = this.proposalMap?.getRoot();
    // let end: UInt32 | undefined = await this.fetchCurrentBlockHeight();
    // let start: UInt32 | undefined;
    // if (end === undefined) {
    //   console.warn(
    //     'Cannot fetch the current block height. Will download all events.'
    //   );
    // }

    // while (!foundSyncPoint) {
    //   if (end) {
    //     const span = BigInt(this.chunkSize - 1);
    //     start = UInt32.from(end.toBigint() > span ? end.toBigint() - span : 0n);
    //   }
    //   const events = (await this.source.fetchEvents(start, end)).filter(
    //     isProposalSupportedEvent
    //   );
    //   // events from latest to oldest
    //   let syncPoint: number | undefined;
    //   for (let i = 0; i < events.length; i++) {
    //     const data = events[i].event.data;
    //     // check if it is a sync point
    //     if (cachedRoot && data.proposalMapRootBefore.equals(cachedRoot).toBoolean()) {
    //       syncPoint = i;
    //       foundSyncPoint = true;
    //       break;
    //     }
    //   }
    //   // if sync point is found then we can discard older events
    //   // i.e. events following the syncPoint
    //   // otherwise keep all
    //   const collected =
    //     syncPoint === undefined ? events : events.slice(0, syncPoint+1);
    //   // now attach this chunk in front of the others from oldest to newest
    //   toApply.unshift(...collected.reverse());

    //   if (end === undefined) {
    //     if (events.length === 0) {
    //       // no more events to process
    //       break;
    //     }
    //     // let's try again from the oldest event
    //     end = events[events.length - 1].blockHeight;
    //   } else if (end.toBigint() <= 0n) {
    //     // we reached genesis
    //     break;
    //   } else {
    //     end = start;
    //   }
    // }

    // if (!foundSyncPoint && this.proposalMap) {
    //   throw new Error(
    //     'Could not find a ProposalSupported event whose proposalMapRootBefore ' +
    //       'matches the cached root; the proposal map cannot be rebuilt'
    //   );
    // }
    // // now we assume that either there was no map whatsoever
    // // so we apply the events or that we reached the sync point
    // const map = this.proposalMap ? this.proposalMap : new ProposalMap();

    // for (const ev of toApply) {
    //   const d = ev.event.data;
    //   // debug log event data
    //   Provable.log('applying ProposalSupported event data:', d);
    //   map.set(d.updateHash, d.acceptedVoteBitArray);
    // }
    // this.proposalMap = map;
  }

  public static rebuildProposalMap(
    events: Array<{ type: string; event: { data: any }; blockHeight: UInt32 }>
  ): ProposalMap {
    const ret = new ProposalMap();
    ProposalMapContractEventsProvider.applyEvents(ret, events);
    return ret;
  }

  public static applyEvents(
    proposalMap: ProposalMap,
    events: Array<{ type: string; event: { data: any }; blockHeight: UInt32 }>
  ): void {
    const proposalSupportedEvents = events.filter(isProposalSupportedEvent);
    const sortedEvents = proposalSupportedEvents.sort((a, b) =>
      a.blockHeight.toBigint() < b.blockHeight.toBigint() ? -1 : 1
    );
    sortedEvents.forEach((e) =>
      proposalMap.set(
        e.event.data.updateHash,
        e.event.data.acceptedVoteBitArray
      )
    );
  }
}
