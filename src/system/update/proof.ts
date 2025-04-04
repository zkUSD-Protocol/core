import { DynamicProof, Proof } from "o1js";
import { ZkusdProtocolUpdateInput } from "./input.js";
import { ZkusdProtocolUpdateOutput } from "./output.js";
import { AdminSigFeatureFlags } from "../../proofs/gov/admin-signature.js";

export class ZkusdProtocolUpdateGovContractProof extends Proof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
}

export class ZkusdProtocolUpdateProof extends DynamicProof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
  static featureFlags = AdminSigFeatureFlags; // should support all the intented proofs
}
