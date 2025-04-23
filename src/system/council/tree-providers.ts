import { ResolutionTree } from './resolution-tree.js';
import { ProposalMap } from './proposal-merkle-map.js';
import { CouncilTree } from './council-tree.js';

/**
 * Generic interface for providing Merkle data structures.
 *
 * Allows consumers to retrieve the structure (`get`) and
 * optionally refresh its contents (`refresh`) from any source.
 */
export interface IMerkleDataProvider<T> {
  /** Returns the current instance of the Merkle structure.
      It is responsible to make sure that the data is matching the
      onchain root.
  */
  get(): Promise<T>;
}


/**
 * A set of Merkle data providers used across the governance system.
 *
 * Provides access to:
 * - The council membership tree
 * - The resolution update tree
 * - The proposal-to-votes mapping
 */
export type CouncilTreeProviders = {
  councilTree: IMerkleDataProvider<CouncilTree>;
  resolutionTree: IMerkleDataProvider<ResolutionTree>;
  proposalMap: IMerkleDataProvider<ProposalMap>;
};
