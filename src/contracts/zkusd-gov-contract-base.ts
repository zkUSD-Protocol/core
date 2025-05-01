import { Bool, Field, PublicKey, SmartContract, State, method } from "o1js";
import { EngineUpdateSpec } from "../system/engine-update/input";
import { ResolutionTree } from "../system/council/data/resolution-tree";

export class ZkUsdGovernmentContract extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.

  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionUpdateSpec: EngineUpdateSpec,
    resolutionWitness: ResolutionTree.Witness,
  ) {
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

/**
 * A helper constructor type for the ZkUsdGovernmentContract.
 *
 * Accepts a `PublicKey` address to initialize a governance contract instance.
 */
export type ZkUsdGovernmentConstructor = new (
  address: PublicKey
) => ZkUsdGovernmentContract;
