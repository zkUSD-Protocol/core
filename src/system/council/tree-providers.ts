import { Field, MerkleMap, MerkleTree, PublicKey, UInt32 } from "o1js";

export interface IResolutionMerkleTreeProvider {
    getNextEmptyResolutionIndex(): Promise<UInt32>
    getResolutionMerkleTree(): Promise<MerkleTree>
}

export interface IProposalMerkleMapProvider {
    getProposalMerkleTree(): Promise<MerkleMap>
}

export interface ICouncilMerkleTreeProvider {
    getCouncilMembersAndTree(): Promise<{
        councilMembers: PublicKey[],
        councilTree: MerkleTree
    }>
}
