import {
  AccountUpdate,
  Bool,
  Field,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  Signature,
  SmartContract,
  State,
  VerificationKey,
  method,
  Permissions,
  state,
} from 'o1js';
import {
  ZkusdProtocolUpdateGovContractProof,
  ZkusdProtocolUpdateInput,
  zkusdProtocolUpdateInputToFields,
} from '../system/update.js';

import { ZkusdGovResolutionProgramWitness } from '../system/governance.js';
import { ZkUsdEngineMethodCodes } from '../system/engine.js';
import { AdminSignatureZkusdProtocolUpdateProgram } from '../proofs/gov/admin-signature.js';
import { ZkusdProtocolUpdateProof } from '../system/update-proof.js';

export class ZkUsdGovernmentPoc extends SmartContract {
  // @state(Field) govResolutionProgramsVkHashesRoot = State<Field>(); // Pins the set of accepted governance programs. (not used yet)

  // // it is debatable if we need to store this in the on-chain state as we won't need to verify it most likely.
  // // if we want to save the space, we can use event to alert about the root ipns mirrors and changes.
  // // but it will make some operations more complex and expensive.
  // @state(IpnsAddr) zkusdProtocolDataRootIpns = State<IpnsAddr>(); // IPNS address of the protocol data root. (not used yet)

  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    _resolutionProgramVk: VerificationKey,
    _resolutionProgramVkhWitness: ZkusdGovResolutionProgramWitness,
    _resolutionProof: ZkusdProtocolUpdateProof
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
type ZkUsdDeployArgs = {
  verificationKey?: {
    data: string;
    hash: Field | string;
  };
};

export class ZkUsdAdminSignatureContract extends ZkUsdGovernmentPoc {
  @state(PublicKey) adminPublicKey = State<PublicKey>();
  @state(Field) stopProtocolVkHash = State<Field>();

  async initialize(adminPublicKey: PublicKey, stopProtocolVkHash: Field) {
    this.adminPublicKey.set(adminPublicKey);
    this.stopProtocolVkHash.set(stopProtocolVkHash);
  }

  async deploy(args?: ZkUsdDeployArgs): Promise<void> {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.VerificationKey.signature(),

      editState: Permissions.proof(),
      send: Permissions.proof(),
    });
  }

  async ensureAdminSignature(): Promise<AccountUpdate> {
    const admin = this.adminPublicKey.getAndRequireEquals();
    return AccountUpdate.createSigned(admin);
  }

  @method
  async changeAdmin(newAdmin: PublicKey) {
    await this.ensureAdminSignature();
    this.adminPublicKey.set(newAdmin);
  }

  /** Admin signature proofs can be executed iff:
      the vk key matches one pinned to the on-chain state of this contract.
      The contract admin public matches the one in the output of the proof:
      See: `AdminSignatureZkusdProtocolUpdateProgram` output.
      The `zkMethodCode` is explicitly permited by this contract.
  */
  @method.returns(Bool)
  public async canExecuteGovResolution(
    zkEngineMethodCode: Field,
    resolutionProgramVk: VerificationKey,
    resolutionProgramVkhWitness: ZkusdGovResolutionProgramWitness,
    resolutionProof: ZkusdProtocolUpdateProof
  ) {
    // the method is allowed:
    // some methods may have different verification requirements.
    const methodAllowed = zkEngineMethodCode
      .equals(ZkUsdEngineMethodCodes.GovStopProtocol)
      .or(
        zkEngineMethodCode.equals(
          ZkUsdEngineMethodCodes.GovUpdateCollateralRatio
        )
      );
    methodAllowed.assertTrue('Method not allowed');

    // verify the verification key against the on-chain state.
    const vkh = this.stopProtocolVkHash.getAndRequireEquals();

    Provable.log('resolutionProgramVk', resolutionProgramVk.hash, vkh);
    vkh.assertEquals(resolutionProgramVk.hash);

    resolutionProof.verify(resolutionProgramVk);
    Provable.log('proof verified');

    Provable.log(
      'resolutionIndex',
      resolutionProof.publicInput.govResolutionIndex
    );

    // verify the proof's admin key against the on-chain state.
    const currentAdminHash = Poseidon.hash(
      this.adminPublicKey.getAndRequireEquals().toFields()
    );
    const proofAdminHash = resolutionProof.publicOutput.auxilliaryOutput[0];

    Provable.log('admin keys hashes', currentAdminHash, proofAdminHash);

    currentAdminHash.assertEquals(
      proofAdminHash,
      'Admin public key does not match the proof'
    );
    Provable.log('return true');

    return Bool(true);
  }

  public async signAndCreateProtocolUpdate(
    input: ZkusdProtocolUpdateInput,
    adminPrivateKey: PrivateKey
  ): Promise<ZkusdProtocolUpdateGovContractProof> {
    const signature = Signature.create(
      adminPrivateKey,
      zkusdProtocolUpdateInputToFields(input)
    );
    return this.createProtocolUpdate(input, signature);
  }

  public async createProtocolUpdate(
    input: ZkusdProtocolUpdateInput,
    signature: Signature
  ): Promise<ZkusdProtocolUpdateGovContractProof> {
    const adminPublicKey = this.adminPublicKey.getAndRequireEquals();
    const proof = await AdminSignatureZkusdProtocolUpdateProgram.create(
      input,
      signature,
      adminPublicKey,
    );
    return proof.proof;
  }
}



