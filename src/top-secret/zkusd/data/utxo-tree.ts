import { Field, MerkleTree, MerkleWitness } from 'o1js';

const UTXO_TREE_HEIGHT = 32;

export class UtxoWitness extends MerkleWitness(UTXO_TREE_HEIGHT) {
  static HEIGHT = UTXO_TREE_HEIGHT;
}

export class UtxoTree extends MerkleTree {
  static readonly HEIGHT = UtxoWitness.HEIGHT;
  static readonly Witness = UtxoWitness;
  private _next: bigint = 0n;

  constructor() {
    super(UTXO_TREE_HEIGHT);
  }

  get next(): bigint {
    return this._next;
  }

  insert(leaf: Field): void {
    this.setLeaf(this._next, leaf);
    this._next++;
  }
}

export namespace UtxoTree {
  export type Witness = UtxoWitness;
}
