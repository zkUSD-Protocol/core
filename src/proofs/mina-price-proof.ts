import { DynamicProof, Field, MerkleWitness, PublicKey, Struct, UInt32, UInt64, VerificationKey, ZkProgram } from "o1js";
import { MinaPrice } from "../types";

const MERKLE_TREE_HEIGHT = 5;
export const MAX_ORACLE_COUNT = 2 ** (MERKLE_TREE_HEIGHT - 1);

class MerkleTreeWitness extends MerkleWitness(MERKLE_TREE_HEIGHT) {}


export class MinaPriceProofPublicInput extends Struct({
  firstValidBlockHeight: UInt32,
  lastValidBlockHeight: UInt32,
  oracleWhitelistMerkleRoot: Field
}) {}

export class MinaPriceProofPublicOutput extends Struct({
  minaPrice: MinaPrice,
  incentivizedOracle: PublicKey,
}) {}

export class MinaPriceProofOracleData extends Struct({
  publicKey: PublicKey,
  priceForSlot: UInt32,
  priceInNanoUsd: UInt64,
  witness: MerkleTreeWitness,
}) {}

// TODO
export const ProveMinaPriceProgram = ZkProgram({
  name: 'ProveMinaPriceProgram',
  publicInput: MinaPriceProofPublicInput,
  publicOutput: MinaPriceProofPublicOutput,
  methods: {
    compute: {
      privateInputs: [MinaPriceProofOracleData],
      async method(publicInput: MinaPriceProofPublicInput, oracleData1: MinaPriceProofOracleData) {
        const ret = new MinaPrice(
          { priceNanoUSD: oracleData1.priceInNanoUsd,
            firstValidBlockHeight: publicInput.firstValidBlockHeight,
            lastValidBlockHeight: publicInput.lastValidBlockHeight,}
        );
        return {
          publicOutput: {minaPrice: ret, incentivizedOracle: oracleData1.publicKey},
        };
      },
    },
  },
});


export class MinaPriceProof extends DynamicProof<MinaPriceProofPublicInput, MinaPriceProofPublicOutput>{
  static publicInputType = MinaPriceProofPublicInput;
  static publicOutputType = MinaPriceProofPublicOutput;
  static maxProofsVerified = 2 as const; // not sure so I put 2  (as told in proof.d.ts)
}

export class MinaPriceInput extends Struct({
  proof: MinaPriceProof,
  verificationKey: VerificationKey
}) {}

export const verifyMinaPriceInput = async(args:{input: MinaPriceInput, oracleWhitelistRoot: Field, proofVkHash: Field, firstValidBlockHeight: UInt32, lastValidBlockHeight: UInt32}) => {
  const {input, oracleWhitelistRoot, proofVkHash, firstValidBlockHeight, lastValidBlockHeight} = args;

  input.verificationKey.hash.assertEquals(proofVkHash, 'Invalid verification key hash');
  input.proof.publicInput.oracleWhitelistMerkleRoot.assertEquals(oracleWhitelistRoot, 'Invalid oracle whitelist root');
  input.proof.publicInput.firstValidBlockHeight.assertEquals(firstValidBlockHeight, 'Invalid first valid slot');
  input.proof.publicInput.lastValidBlockHeight.assertEquals(lastValidBlockHeight, 'Invalid last valid slot');
  input.proof.verify(input.verificationKey);
}


