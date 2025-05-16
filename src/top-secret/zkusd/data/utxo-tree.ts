import { Field, MerkleTree, MerkleWitness } from 'o1js';

const UTXO_TREE_HEIGHT = 256;

export class UtxoWitness extends MerkleWitness(UTXO_TREE_HEIGHT) {
  static HEIGHT = UTXO_TREE_HEIGHT;

  static dummy(): UtxoWitness {
    return new UtxoWitness(
      Array(UTXO_TREE_HEIGHT - 1).fill({ isLeft: true, sibling: Field(0) })
    );
  }
}

export class UtxoTree extends MerkleTree {
  static readonly HEIGHT = UtxoWitness.HEIGHT;
  static readonly Witness = UtxoWitness;

  constructor() {
    super(UTXO_TREE_HEIGHT);
  }
}

export namespace UtxoTree {
  export type Witness = UtxoWitness;
}
