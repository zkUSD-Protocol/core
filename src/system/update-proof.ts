import {
  DynamicProof,
} from 'o1js';
import {
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput,
} from './update.js';
import { AdminSigFeautureFlags } from '../proofs/gov/admin-signature.js';

export class ZkusdProtocolUpdateProof extends DynamicProof<
  ZkusdProtocolUpdateInput,
  ZkusdProtocolUpdateOutput
> {
  static publicInputType = ZkusdProtocolUpdateInput;
  static publicOutputType = ZkusdProtocolUpdateOutput;
  static maxProofsVerified = 2 as const;
  static featureFlags = AdminSigFeautureFlags; // should support all the intented proofs
}
