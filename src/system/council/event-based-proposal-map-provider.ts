import { Field, UInt32 } from 'o1js';
import { IMerkleDataProvider } from './tree-providers.js';
import { ContractEvent, FetchOnchainRoot, HasFetchEvents, isContractEvent } from './common.js';
import { ProposalMap } from './proposal-merkle-map.js';
import { ZkusdGoverningCouncilContract } from '../../contracts/zkusd-governing-council.js';

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
export class ProposalMapContractProvider
  implements IMerkleDataProvider<ProposalMap>
{
  private proposalMap: ProposalMap

  /**
   * @param source - Any object with a `fetchEvents()` method.
   * @param chunkSize - Number of block heights to fetch per request (default 1000).
   */
  constructor(
    private readonly source: HasFetchEvents,
    private readonly fetchOnchainRoot: FetchOnchainRoot,
    private readonly chunkSize = 1000
  ) {}


  static fromContract(
    councilContract: ZkusdGoverningCouncilContract,
    chunkSize = 1000
  ) : ProposalMapContractProvider {
    return new ProposalMapContractProvider(
      councilContract,
      async () => {
        const root = await councilContract.proposalsMerkleMapRoot.fetch();
        return root;
      },
      chunkSize
    );
  }

  /**
   * Returns the cached `ResolutionTree`, loading it on first access.
   */
  async get(): Promise<ProposalMap> {
    if (!this.proposalMap || await this.isStale()) {
      await this.refresh();
      const stillStale = await this.isStale();
      if(stillStale) throw new Error('The data does not match the onchain state even after refreshing.')
    }
    return this.proposalMap!;
  }

  async isStale(): Promise<boolean> {
    const currentRoot = this.proposalMap?.getRoot();
    if(!currentRoot) {
      return true;
    }
    const onchainRoot = await this.fetchOnchainRoot();
    if(!onchainRoot) {
      throw new Error("Cannot fetch proposal map root from the chain.");
    }
    return onchainRoot.equals(currentRoot).not().toBoolean();
  }

  /**
   * Rebuilds or updates the tree by scanning `ProposalPassed` events
   * backwards in fixed-size chunks until:
   *  - a matching previous root is found, or
   *  - genesis is reached.
   */
  async refresh(): Promise<void> {
    const toApply: ProposalSupportedEvent[] = [];

    const cachedRoot: Field | null = this.proposalMap?.getRoot() ?? null;
    let foundSyncPoint = cachedRoot === null;
    let end: UInt32 | undefined = undefined; // undefined → latest

    while (true) {
      // Calculate chunk bounds
      let start: UInt32 | undefined;
      if (end) {
        const span = BigInt(this.chunkSize - 1);
        const endHeight = end.toBigint();
        start = UInt32.from(endHeight > span ? endHeight - span : 0n);
      }

      const allEvents = await this.source.fetchEvents(start, end);
      if (allEvents.length === 0) break;

      const events = allEvents.filter(isProposalSupportedEvent);

      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        const data = event.event.data;

        if (!foundSyncPoint) {
          if (data.proposalMapRootBefore.equals(cachedRoot!)) {
            foundSyncPoint = true;
          } else {
            continue;
          }
        }

        toApply.unshift(event); // Maintain oldest-to-newest order
      }

      // Exit if we've synced and have everything we need
      if (foundSyncPoint && cachedRoot) break;

      // Prepare to fetch the next older chunk
      const oldest = events.length
        ? events[events.length - 1].blockHeight.toBigint()
        : start?.toBigint() ?? 0n;

      if (oldest === 0n) break;
      end = UInt32.from(oldest - 1n);
    }

    // Apply all collected events to either a fresh or existing tree
    const proposalMap = foundSyncPoint && this.proposalMap ? this.proposalMap : new ProposalMap();

    for (const event of toApply) {
      const data = event.event.data;
      proposalMap.set(data.resolutionIndex.value, data.acceptedVoteBitArray);
    }

    this.proposalMap = proposalMap;
  }
}
