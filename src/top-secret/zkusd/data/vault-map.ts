import { Experimental } from 'o1js';

const VAULT_MAP_HEIGHT = 14; // 16,384
// const VAULT_MAP_HEIGHT = 20; // 1,048,576

const { IndexedMerkleMap } = Experimental;

export class VaultMap extends IndexedMerkleMap(VAULT_MAP_HEIGHT) {}
