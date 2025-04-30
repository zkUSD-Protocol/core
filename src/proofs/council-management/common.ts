import { MerkleWitness, Experimental, Field } from 'o1js';
import { ZkusdCouncilManagementActions } from '../../system/council-management/input';

const { IndexedMerkleMap } = Experimental;

const MAX_ZKUSD_COUNCIL_SIZE = 240; // so that we get bitwise operations which cap at 240 bits per field (more (up to 254) may result in potential underconstraint issues in the circuit)
const MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE: bigint =
  2n ** BigInt(MAX_ZKUSD_COUNCIL_SIZE);
const ZKUSD_COUNCIL_TREE_HEIGHT = 9; // will fit the 240 council members

class ZkusdCouncilWitness extends MerkleWitness(ZKUSD_COUNCIL_TREE_HEIGHT) {}

class ZkusdCouncilMerkleMap extends IndexedMerkleMap(
  ZKUSD_COUNCIL_TREE_HEIGHT
) {
  getNextEmptyIndex(): number {
    const data = this.data.get();
    const lastSeatLeaf = data.sortedLeaves[data.sortedLeaves.length - 1];
    const lastSeatIndex = lastSeatLeaf.index;

    if (lastSeatIndex === MAX_ZKUSD_COUNCIL_SIZE) {
      throw new Error('Council size limit reached');
    }

    return lastSeatIndex + 1;
  }

  getNextEmptySeatPosition(): Field {
    const data = this.data.get();
    const lastSeatLeaf = data.sortedLeaves[data.sortedLeaves.length - 1];
    const lastSeatIndex = lastSeatLeaf.index;

    if (lastSeatIndex === MAX_ZKUSD_COUNCIL_SIZE) {
      throw new Error('Council size limit reached');
    }

    return Field.from(2n ** BigInt(lastSeatIndex + 1));
  }
}

export {
  MAX_ZKUSD_COUNCIL_SIZE,
  MAX_ZKUSD_COUNCIL_SIZE_FIELD_VALUE,
  ZKUSD_COUNCIL_TREE_HEIGHT,
  ZkusdCouncilWitness,
  ZkusdCouncilMerkleMap,
};
