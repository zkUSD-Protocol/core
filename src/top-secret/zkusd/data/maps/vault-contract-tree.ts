import { MerkleTree, MerkleWitness } from "o1js";

const VAULT_CONTRACT_TREE_HEIGHT = 6;

export const VaultContractTree =  new MerkleTree(VAULT_CONTRACT_TREE_HEIGHT);

export class VaultContractTreeWitness extends MerkleWitness(VAULT_CONTRACT_TREE_HEIGHT) {}

