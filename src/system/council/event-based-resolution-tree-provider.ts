import { UInt32 } from 'o1js';
import { ResolutionTree } from './resolution-tree.js';
import { IMerkleDataProvider } from './tree-providers.js';
import {
  ContractEvent,
  FetchCurrentBlockHeight,
  FetchOnchainRoot,
  HasFetchEvents,
  isContractEvent,
} from './common.js';
import { ZkusdGoverningCouncilContract } from '../../contracts/zkusd-governing-council.js';
import { Provable } from 'o1js';

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
function isProposalPassedEvent(
  e: unknown
): e is ContractEvent<'ProposalPassed'> {
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
    private readonly fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    private readonly chunkSize = 1000
  ) {}

  static fromContract(
    councilContract: ZkusdGoverningCouncilContract,
    fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    chunkSize = 1000
  ): ResolutionTreeContractProvider {
    return new ResolutionTreeContractProvider(
      councilContract,
      () => councilContract.resolutionsMerkleRoot.fetch(),
      fetchCurrentBlockHeight,
      chunkSize
    );
  }

  /**
   * Returns the cached `ResolutionTree`, loading it on first access.
   */
  async get(): Promise<ResolutionTree> {
    if (!this.tree || (await this.isStale())) {
      await this.refresh();
      const stillStale = await this.isStale();
      if (stillStale)
        throw new Error(
          'The data does not match the onchain state even after refreshing.'
        );
    }
    return this.tree!;
  }

  async isStale(): Promise<boolean> {
    let currentRoot = this.tree?.getRoot();
    if (!currentRoot) {
      throw new Error(
        'Cannot check if proposal map is stale: no root available.'
      );
    }
    Provable.log("tree root: ", currentRoot);
    const onchainRoot = await this.fetchOnchainRoot();
    if (!onchainRoot) {
      throw new Error('Cannot fetch proposal map root from the chain.');
    }
    Provable.log("onchain root: ", onchainRoot);
    return onchainRoot.equals(currentRoot).not().toBoolean();
  }

  /**
   * Rebuilds or updates the tree by scanning `ProposalPassed` events
   * backwards in fixed-size chunks until:
   *  - a matching previous root is found, or
   *  - genesis is reached.
   */
  async refresh(): Promise<void> {
    // get the latest chunk (ordered from newest to latest)
    // search for sync point, if found them discard all previous events
    // if not found it probably means that these events are to be applied yet
    // but proceed in searching in the previous chunk
    // when finally found then apply all the not discarded events from all the chunks
    // processed
    // if reached genesis without sync point then throw an error

    const toApply: ProposalPassedEvent[] = [];
    let foundSyncPoint = false
    const cachedRoot = this.tree?.getRoot();
    let end: UInt32 | undefined = await this.fetchCurrentBlockHeight();
    let start: UInt32 | undefined;
    if (end === undefined) {
      console.warn(
        'Cannot fetch the current block height. Will download all events.'
      );
    }

    while (!foundSyncPoint) {
      if (end) {
        const span = BigInt(this.chunkSize - 1);
        start = UInt32.from(end.toBigint() > span ? end.toBigint() - span : 0n);
      }
      const events = (await this.source.fetchEvents(start, end)).filter(
        isProposalPassedEvent
      );
      // events from latest to oldest
      let syncPoint: number | undefined;
      for (let i = 0; i < events.length; i++) {
        const data = events[i].event.data;
        // check if it is a sync point
        if (cachedRoot && data.resolutionTreeRootBefore.equals(cachedRoot).toBoolean()) {
          syncPoint = i;
          foundSyncPoint = true;
          break;
        }
      }
      // if sync point is found then we can discard older events
      // i.e. events following the syncPoint
      // otherwise keep all
      const collected =
        syncPoint === undefined ? events : events.slice(0, syncPoint+1);
      // now attach this chunk in front of the others from oldest to newest
      toApply.unshift(...collected.reverse());

      if (end === undefined) {
        if (events.length === 0) {
          // no more events to process
          break;
        }
        // let's try again from the oldest event
        end = events[events.length - 1].blockHeight;
      } else if (end.toBigint() <= 0n) {
        // we reached genesis
        break;
      } else {
        end = start;
      }
    }

    if (!foundSyncPoint && this.tree) {
      throw new Error(
        'Could not find a ProposalPassed event whose treeRootBefore ' +
          'matches the cached root; the resolution tree cannot be built'
      );
    }
    // now we assume that either there was no map whatsoever
    // so we apply the events or that we reached the sync point
    const tree = this.tree ? this.tree : new ResolutionTree();

    for (const ev of toApply) {
      const d = ev.event.data;
      // debug log event data
      Provable.log("Applying resolution tree event data: ", d);
      tree.setLeaf(d.resolutionIndex.toBigint(), d.updateHash);
    }
    this.tree = tree;
    Provable.log("Refresh set root to:", tree.getRoot());
  }
}
