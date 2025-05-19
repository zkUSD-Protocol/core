import { Experimental, Field, MerkleMap, MerkleMapWitness } from 'o1js';
import { Bool } from 'o1js';

const ZKUSD_MAP_HEIGHT = 52; // 4,503,599,627,370,496 - 4.5 quadrillion

const { IndexedMerkleMap } = Experimental;

export class ZkUsdMap extends IndexedMerkleMap(ZKUSD_MAP_HEIGHT) {}
