import { MinaChainPreconditions } from '../system/update/blockchain-preconditions';
import {
  ZkusdProtocolUpdateOperation,
  ZkusdProtocolUpdateOperationFields,
} from '../system/update/operation';
import {
  ZkusdProtocolPreconditions,
  ZkusdProtocolPreconditionsFields,
} from '../system/update/protocol-preconditions';
import { Field, PublicKey, Signature } from 'o1js';
import {
  MultiSigZkusdProtocolUpdateProgram,
  ZkusdCouncilMemberWitness,
  ZkusdGoverningCouncilVoteProof,
} from '../proofs/gov/council-multisig.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import { FieldsSigner } from '../signers/types.js';
import {
  ICouncilMerkleTreeProvider,
  IProposalMerkleMapProvider,
  IResolutionMerkleTreeProvider,
} from '../system/council/tree-providers.js';
import { KeyPair } from '../types/utility.js';
import {
  ZkusdGoverningCouncilContract,
  countBits,
} from '../contracts/zkusd-governing-council.js';
import { TransactionManager } from '../transaction/manager.js';

type ProposalUpdateResults = {
  transactionIncluded: boolean;
  votesMissing?: bigint;
  error?: unknown | null;
};

export class ZkusdGoverningCouncilClient {
  readonly councilTreeProvider: ICouncilMerkleTreeProvider;
  readonly resolutionTreeProvider: IResolutionMerkleTreeProvider;
  readonly proposalTreeProvider: IProposalMerkleMapProvider;
  readonly signer: FieldsSigner;
  readonly councilContractAddress: PublicKey;

  txMgr: TransactionManager<any>;

  get councilContract(): ZkusdGoverningCouncilContract {
    return new ZkusdGoverningCouncilContract(this.councilContractAddress);
  }

  public async createUpdateSpec(args: {
    operation:
      | Partial<ZkusdProtocolUpdateOperationFields>
      | ZkusdProtocolUpdateOperation;
    protocolPreconditions: ZkusdProtocolPreconditions;
    blockchainPreconditions: MinaChainPreconditions;
  }): Promise<ZkusdProtocolUpdateSpec> {
    let operation: ZkusdProtocolUpdateOperation;

    if ('protocolUpdateOperation' in args.operation) {
      // Already a ZkusdProtocolUpdateOperation
      operation = args.operation as ZkusdProtocolUpdateOperation;
    } else {
      // Build from partial fields
      operation = ZkusdProtocolUpdateOperation.create(args.operation);
    }
    const index =
      await this.resolutionTreeProvider.getNextEmptyResolutionIndex();

    return ZkusdProtocolUpdateSpec.singleOperation(index, operation, {
      blockchainPreconditions: args.blockchainPreconditions,
    });
  }

  public async createVoteProof(args: {
    updateSpec: ZkusdProtocolUpdateSpec;
    councilSeatIndex: number;
  }): Promise<ZkusdGoverningCouncilVoteProof> {
    const signature = await this.signer.signFields(args.updateSpec.toFields());

    const { councilMembers, councilTree } =
      await this.councilTreeProvider.getCouncilMembersAndTree();
    const councilMember = councilMembers[args.councilSeatIndex];

    const witness = new ZkusdCouncilMemberWitness(
      councilTree.getWitness(BigInt(args.councilSeatIndex))
    );

    const { proof } = await MultiSigZkusdProtocolUpdateProgram.createVote(
      args.updateSpec,
      signature,
      councilMember,
      witness,
      councilTree.getRoot(),
      Field(2 ** args.councilSeatIndex) // The seat index is encoded as 2^index
    );
    return proof;
  }

  public async mergeVoteProofs(
    leftVoteProof: ZkusdGoverningCouncilVoteProof,
    rightVoteProof: ZkusdGoverningCouncilVoteProof
  ) {
    return await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
      leftVoteProof.publicInput,
      leftVoteProof,
      rightVoteProof
    );
  }

  public async submitVote(args: {
    voteProof: ZkusdGoverningCouncilVoteProof;
    councilSeatIndex: number;
    senderKeys: KeyPair;
  }): Promise<ProposalUpdateResults> {
    let proposalTree = await this.proposalTreeProvider.getProposalMerkleTree();
    const resolutionTree =
      await this.resolutionTreeProvider.getResolutionMerkleTree();
    const currentTimeInSeconds = Math.floor(Date.now() / 1000);

    let included = false;
    let error;
    try {
      const txh = await this.txMgr.tx(
        args.senderKeys,
        async () => {
          await this.councilContract.supportProposalHelper(
            args.voteProof,
            proposalTree,
            resolutionTree
          );
        },
        {
          name: `ZkUsd Governing Council Vote in support of proposal ${args.voteProof.publicOutput.proposalHash.toString()} (@${currentTimeInSeconds}`,
        }
      );
      await txh.awaitIncluded();
    } catch (e) {
      error = e;
    }

    proposalTree = await this.proposalTreeProvider.getProposalMerkleTree();
    const currentSupport = countBits(
      proposalTree.get(args.voteProof.publicOutput.proposalHash)
    );
    const threshold =
      await this.councilContract.standardProposalPassThreshold.fetch();

    const votesMissing = threshold
      ? threshold.toBigInt() - currentSupport.toBigInt()
      : undefined;

    return {
      transactionIncluded: included,
      votesMissing,
      error: error,
    };
  }

  public async tryPassProposal(
    updateSpec: ZkusdProtocolUpdateSpec,
    opts?: { force?: boolean }
  ): Promise<ProposalUpdateResults> {
    throw new Error('Not implemented passProposal');
  }

  public async applyPassedProposalToEngine(
    updateSpec: ZkusdProtocolUpdateSpec
  ): Promise<ProposalUpdateResults> {
    throw new Error('Not implemented applyPassedProposalToEngine');
  }

  public async submitVoteAndTryPassAndApply(args: {
    voteProof: ZkusdGoverningCouncilVoteProof;
    councilSeatIndex: number;
    signature: Signature;
    opts?: { force?: boolean };
  }): Promise<ProposalUpdateResults> {
    throw new Error('Not implemented submitVote');
  }
}
