import {
  Bool,
  Field,
  Provable,
  SmartContract,
  method,
  Struct,
} from 'o1js';

import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';

export class ZkUsdGovernmentContract extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.

  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionUpdateSpec: ZkusdProtocolUpdateSpec,
    resolutionWitness: ResolutionTree.Witness
  ) {
    Provable.log('base method called');
    return Bool(false);
  }

  async deploy(args?: {
    verificationKey?: {
      data: string;
      hash: Field | string;
    };
  }): Promise<void> {
    super.deploy(args);
  }
}

export type ZkUsdDeployArgs = {
  verificationKey?: {
    data: string;
    hash: Field | string;
  };
};

export class ProposalData extends Struct({
  proposedUpdate: ZkusdProtocolUpdateSpec,
  proposalVoteBitArray: Field,
}) {
  toFields(): Field[] {
    return [...this.proposedUpdate.toFields(), this.proposalVoteBitArray];
  }
}
