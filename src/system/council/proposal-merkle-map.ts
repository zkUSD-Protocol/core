import { Field, Gadgets, MerkleMap, Provable, UInt8 } from 'o1js';
import { CouncilTree } from './council-tree.js';

/**
 * A MerkleMap that stores votes per proposal.
 *
 * - Keys are proposal update hashes (as `Field`).
 * - Values are bit arrays encoded in `Field`, representing which council members voted.
 * - Each bit corresponds to a council seat index.
 */
export class ProposalMap extends MerkleMap {
  /**
   * Returns the number of council members who voted for the given proposal.
   *
   * @param updateHash - The Field hash identifying the proposal.
   * @returns A `UInt8` count of set bits (votes) in the value field.
   */
  public getVoteCount(updateHash: Field): UInt8 {
    const voteBitArray = this.get(updateHash);
    return ProposalMap.countBits(voteBitArray);
  }

  /**
   * Counts the number of set bits (1s) in the first `MAX_SIZE` bits of a Field.
   *
   * Used to count how many council members voted (since each seat maps to a bit).
   *
   * @param x - A Field representing a bitfield of votes.
   * @returns A `UInt8` representing the total number of set bits.
   */
  public static countBits(x: Field): UInt8 {
    const bits = x.toBits();
    let voteCount = Field.from(0);
    for (let i = 0; i < CouncilTree.MAX_SIZE; i++) {
      voteCount = Provable.if(bits[i], voteCount.add(1), voteCount);
    }
    const ret = UInt8.Unsafe.fromField(voteCount);
    return ret;
  }

  /**
   * Sums two vote bit arrays.
   *
   * Bitwise ORs the two arrays to combine votes.
   *
   * @param leftBitArray - The first vote bit array.
   * @param rightBitArray - The second vote bit array.
   * @returns A `Field` representing the combined votes.
   */
  public static sumVotesProvably(
    leftBitArray: Field,
    rightBitArray: Field
  ): Field {
    return Gadgets.or(
      leftBitArray,
      rightBitArray,
      CouncilTree.MAX_SIZE
    );
  }
}
