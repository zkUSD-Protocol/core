import { DynamicProof, Bool, FeatureFlags, Field, Poseidon, Struct, VerificationKey, ZkProgram, PublicKey, PrivateKey } from "o1js";

const {privateKey, publicKey} = PrivateKey.randomKeypair()

const p1 = ZkProgram({
  name: "asd",
  publicInput: PublicKey,
  publicOutput: Bool,
  methods: {
    test: {
      privateInputs: [PrivateKey],
      async method(
        publicInput: PublicKey,
        privateInput: PrivateKey,
      ): Promise<{ publicOutput: Bool }> {
        const b = privateInput.toPublicKey().equals(publicInput);
        return { publicOutput: b };
      },
    },
  },
});

const p1vk = await p1.compile();


const p2 = ZkProgram({
  name: "bsd",
  publicInput: PublicKey,
  publicOutput: Bool,
  methods: {
    test: {
      privateInputs: [],
      async method(
        publicInput: PublicKey,
      ): Promise<{ publicOutput: Bool }> {
        const b = Bool(true);
        return { publicOutput: b };
      },
    },
  },
});

const p2vk = await p2.compile();


const proof = await p2.test(publicKey);

const p3vk = p2vk;
p3vk.verificationKey.hash = p1vk.verificationKey.hash;


export class DProof extends DynamicProof<
  PublicKey,
  Bool
> {
  static publicSpecType = PublicKey;
  static publicOutputType = Bool;
  static maxProofsVerified = 0 as const;
  // we may want to consider from program list for potential optimizations
  // but this one is universal and dynamic
  static featureFlags = FeatureFlags.allMaybe;
}

const dproof = DProof.fromProof(proof.proof);

dproof.verify(p3vk.verificationKey)
