import { Field, UInt32 } from 'o1js';
import { ResolutionTree } from './resolution-tree.js';
import { IMerkleDataProvider } from './tree-providers.js';
import { ContractEvent, FetchOnchainRoot, HasFetchEvents, isContractEvent } from './common.js';
import { ZkusdGoverningCouncilContract } from '../../contracts/zkusd-governing-council.js';

/* -------------------------------------------------------------------------- */
/*                          Minimal Event Source Contract                     */
/* -------------------------------------------------------------------------- */

/**
 * A runtime-narrowed `ProposalPassed` event with the expected structure.
 */
type ProposalPassedEvent = ContractEvent<'ProposalPassed'>;

/**
 * Runtime check to validate that an event is a `ProposalPassed` event
 * with the correct structure.
 */
function isProposalPassedEvent(e: unknown): e is ContractEvent<'ProposalPassed'> {
  return isContractEvent(e, 'ProposalPassed');
}


/* -------------------------------------------------------------------------- */
/*                     Contract Event-Based ResolutionTree Provider                    */
/* -------------------------------------------------------------------------- */

/**
 * A Merkle data provider that reconstructs a `ResolutionTree`
 * from on-chain `ProposalPassed` events, streamed in chunks.
 *
 * The tree is cached internally and lazily updated. If the existing
 * tree’s root matches an incoming event’s `resolutionTreeRootBefore`,
 * only newer events are replayed.
 */
export class ResolutionTreeContractProvider
  implements IMerkleDataProvider<ResolutionTree>
{
  private tree: ResolutionTree | null = null;

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
  ): ResolutionTreeContractProvider {
    return new ResolutionTreeContractProvider(
      councilContract,
      async () => {
        const root = await councilContract.resolutionsMerkleRoot.fetch();
        return root;
      },
      chunkSize
    );
  }

  /**
   * Returns the cached `ResolutionTree`, loading it on first access.
   */
  async get(): Promise<ResolutionTree> {
    if (!this.tree || await this.isStale()) {
      await this.refresh();
      const stillStale = await this.isStale();
      if(stillStale) throw new Error('The data does not match the onchain state even after refreshing.')
    }
    return this.tree!;
  }

  async isStale(): Promise<boolean> {
    const currentRoot = this.tree?.getRoot();
    if(!currentRoot) {
      return true;
    }
    const onchainRoot = await this.fetchOnchainRoot();
    if(!onchainRoot) {
      throw new Error("Cannot fetch resolution tree root from the chain.");
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
    const toApply: ProposalPassedEvent[] = [];

    const cachedRoot: Field | null = this.tree?.getRoot() ?? null;
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

      const events = allEvents.filter(isProposalPassedEvent);

      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        const data = event.event.data;

        if (!foundSyncPoint) {
          if (data.resolutionTreeRootBefore.equals(cachedRoot!)) {
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
    const tree = foundSyncPoint && this.tree ? this.tree : new ResolutionTree();

    for (const event of toApply) {
      const data = event.event.data;
      tree.setLeaf(data.resolutionIndex.toBigint(), data.updateHash);
    }

    this.tree = tree;
  }
}
