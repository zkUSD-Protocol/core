import { Proof } from "o1js";
import { ZkusdProtocolUpdateSpec } from "./input.js";
import { ZkusdProtocolUpdateOutput } from "./output.js";

export class ZkusdGoverningCouncilVoteProof extends Proof<
  ZkusdProtocolUpdateSpec,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateSpec;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
}
