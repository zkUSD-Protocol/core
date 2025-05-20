import { Field, MerkleList, PublicKey, Struct } from 'o1js';

export class Oracle extends Struct({
  publicKey: PublicKey,
}) {
  static new(publicKey: PublicKey): Oracle {
    return new Oracle({ publicKey });
  }
}

export class Oracles extends MerkleList<Oracle> {
  static new(oracles: Oracle[]): Oracles {
    return MerkleList.create(Oracle).from(oracles);
  }
}
