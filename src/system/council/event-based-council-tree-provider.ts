import { PublicKey, UInt32 } from 'o1js';
import { IMerkleDataProvider } from './tree-providers.js';
import {
  ContractEvent,
  FetchCurrentBlockHeight,
  FetchOnchainRoot,
  HasFetchEvents,
  isContractEvent,
} from './common.js';
import { CouncilTree } from './council-tree.js';
import { ZkusdGoverningCouncilContract } from '../../contracts/zkusd-governing-council.js';

/**
 * A runtime-narrowed `ProposalSupported` event with the expected structure.
 */
type NewCouncilEvent = ContractEvent<'NewCouncilInitializedWithFixedKeys'>;

/**
 * Runtime check to validate that an event is a `ProposalSupported` event
 * with the correct structure.
 */
export function isNewCouncilEvent(e: unknown): e is NewCouncilEvent {
  return isContractEvent(e, 'NewCouncilInitializedWithFixedKeys');
}
/* -------------------------------------------------------------------------- */
/*                     Contract Event-Based ResolutionTree Provider                    */
/* -------------------------------------------------------------------------- */

/**
 * A Merkle data provider that reconstructs a `Council`
 * from an on-chain `NewCouncilEvent` event.
 * Events are streamed in chunks until the event is found.
 */
export class CouncilTreeContractProvider
  implements IMerkleDataProvider<CouncilTree>
{
  private tree: CouncilTree;

  /**
   * @param source - Any object with a `fetchEvents()` method.
   * @param chunkSize - Number of block heights to fetch per request (default 1000).
   */
  constructor(
    private readonly source: HasFetchEvents,
    private readonly fetchOnchainRoot: FetchOnchainRoot,
    private readonly fetchCurrentBlockHeighr: FetchCurrentBlockHeight,
    private readonly chunkSize = 1000
  ) {}

  static fromContract(
    councilContract: ZkusdGoverningCouncilContract,
    fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    chunkSize = 1000
  ): CouncilTreeContractProvider {
    return new CouncilTreeContractProvider(
      councilContract,
      () => councilContract.councilMembersMerkleRoot.fetch(),
      fetchCurrentBlockHeight,
      chunkSize
    );
  }

  /**
   * Returns the cached `ResolutionTree`, loading it on first access.
   */
  async get(): Promise<CouncilTree> {
    if (!this.tree) {
      await this.build();
    }
    const onchainRoot = await this.fetchOnchainRoot();
    if (!onchainRoot) {
      throw new Error('Cannot fetch on-chain root for the council tree.');
    }
    if (onchainRoot.equals(this.tree.getRoot()).not().toBoolean()) {
      console.error('On-chain root:', onchainRoot.toString());
      console.error('Event root:', this.tree.getRoot().toString());
      throw new Error(
        'The on-chain root of the council tree does not match the event data.'
      );
    }
    return this.tree;
  }

  /**
   * Builds a council tree based on an event emited from a contract.
   * It scans events until it finds a one of the type `NewCouncilEvent`
   * and uses its data to construct the tree.
   */
  async build(): Promise<void> {
    let end: UInt32 | undefined = await this.fetchCurrentBlockHeighr();
    if (end === undefined) {
      console.warn(
        'Cannot fetch the current block height. Will download all events.'
      );
    }

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

      const events = allEvents.filter(isNewCouncilEvent);
      if (events.length > 0) {
        // Take the most recent matching event
        const latestEvent = events[events.length - 1];
        const data = latestEvent.event.data;

        const councilKeys: PublicKey[] =
          data.councilMembers.councilMembers.filter((k) =>
            k.isEmpty().not().toBoolean()
          );

        if (councilKeys.length === 0) {
          throw new Error('Council event found but no valid council members.');
        }

        // Construct the tree from the council keys
        // debug log new council members

        this.tree = new CouncilTree(councilKeys);
        return; // Successful, exit
      }

      const oldest =
        allEvents[allEvents.length - 1]?.blockHeight.toBigint() ?? 0n;
      if (oldest === 0n) break;
      end = UInt32.from(oldest - 1n);
    }

    throw new Error(
      'No NewCouncilInitializedWithFixedKeys event found in event history.'
    );
  }
}
