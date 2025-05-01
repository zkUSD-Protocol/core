import { ResolutionTree } from './resolution-tree.js';
import { ProposalMap } from './proposal-merkle-map.js';
import { CouncilMap } from './council-map.js';
import { IMerkleDataProvider } from './imerkle-data-provider.js';
import { ZkusdGoverningCouncilContract } from '../../../contracts/zkusd-governing-council.js';
import { ResolutionTreeContractEventsProvider } from './event-based-resolution-tree-provider.js';
import { CouncilMapContractEventsProvider } from './event-based-council-map-provider.js';
import { ProposalMapContractEventsProvider } from './event-based-proposal-map-provider.js';
import { FetchCurrentBlockHeight } from '../common.js';


/**
 * A set of Merkle data providers used across the governance system.
 *
 * Provides access to:
 * - The council membership map
 * - The resolution update tree
 * - The proposal-to-votes mapping
 */
export type CouncilDataProvider = {
  councilMap: IMerkleDataProvider<CouncilMap>;
  resolutionTree: IMerkleDataProvider<ResolutionTree>;
  proposalMap: IMerkleDataProvider<ProposalMap>;
};

export namespace CouncilDataProvider {
  export function fromContractEvents(
    councilContract: ZkusdGoverningCouncilContract,
    fetchCurrentBlockHeight: FetchCurrentBlockHeight,
    chunkSize = 1000
  ): CouncilDataProvider {
    return {
      councilMap: CouncilMapContractEventsProvider.fromContract(councilContract, fetchCurrentBlockHeight),
      resolutionTree: ResolutionTreeContractEventsProvider.fromContract(councilContract, fetchCurrentBlockHeight),
      proposalMap: ProposalMapContractEventsProvider.fromContract(councilContract, fetchCurrentBlockHeight),
    };
  }
}