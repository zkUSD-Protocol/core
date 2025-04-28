import { MinaChainPreconditions } from '../system/update/blockchain-preconditions.js';
import {
  ZkusdProtocolUpdateOperation,
  ZkusdProtocolUpdateOperationFields,
} from '../system/update/operation.js';
import {
  ZkusdProtocolPreconditions,
} from '../system/update/protocol-preconditions.js';
import { Bool, Poseidon, PublicKey, Signature, UInt8 } from 'o1js';
import {
  MultiSigZkusdProtocolUpdateProgram,
  ZkusdGoverningCouncilVoteProof,
} from '../proofs/gov/council-multisig.js';
import { ZkusdProtocolUpdateSpec } from '../system/update/input.js';
import {
  CouncilTreeProviders,
} from '../system/council/tree-providers.js';
import { KeyPair } from '../types/utility.js';
import {
  ZkusdGoverningCouncilContract,
} from '../contracts/zkusd-governing-council.js';
import { TransactionManager } from '../transaction/manager.js';
import { proveProposalSupport } from '../system/council/prove.js';
import { ProposalMap } from '../system/council/proposal-merkle-map.js';
import { ResolutionTree } from '../system/council/resolution-tree.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import { CouncilTreeContractProvider } from '../system/council/event-based-council-tree-provider.js';
import { ProposalMapContractProvider } from '../system/council/event-based-proposal-map-provider.js';
import { ResolutionTreeContractProvider } from '../system/council/event-based-resolution-tree-provider.js';

type ProposalUpdateResults = {
  transactionIncluded: boolean;
  votesMissing?: bigint;
  info?: string | null;
};

export interface IZkusdGoverningCouncilClient {
  readonly trees: CouncilTreeProviders;

  get councilContract(): ZkusdGoverningCouncilContract;

  createUpdateSpec(args: {
    operation: Partial<ZkusdProtocolUpdateOperationFields> | ZkusdProtocolUpdateOperation;
    protocolPreconditions: ZkusdProtocolPreconditions;
    blockchainPreconditions: MinaChainPreconditions;
  }): Promise<ZkusdProtocolUpdateSpec>;

  createVoteProof(args: {
    updateSpec: ZkusdProtocolUpdateSpec;
    signature: Signature;
    seat: number | bigint | UInt8 | PublicKey;
  }): Promise<ZkusdGoverningCouncilVoteProof>;


  mergeVoteProofs(
    leftVoteProof: ZkusdGoverningCouncilVoteProof,
    rightVoteProof: ZkusdGoverningCouncilVoteProof
  ): Promise<ZkusdGoverningCouncilVoteProof>;

  submitVote(
    voteProof: ZkusdGoverningCouncilVoteProof,
    senderKeys: KeyPair,
    args?: {force?: boolean},
  ): Promise<ProposalUpdateResults>;

  tryPassProposal(
    updateSpec: ZkusdProtocolUpdateSpec,
    senderKeys: KeyPair,
    opts?: { force?: boolean }
  ): Promise<ProposalUpdateResults>;

  applyPassedProposalToEngine(
    updateSpec: ZkusdProtocolUpdateSpec,
    senderKeys: KeyPair
  ): Promise<ProposalUpdateResults>;

  submitVoteAndTryPassAndApply(args: {
    voteProof: ZkusdGoverningCouncilVoteProof;
    senderKeys: KeyPair;
    opts?: { force?: boolean };
  }): Promise<ProposalUpdateResults>;
}

export class ZkusdGoverningCouncilClient implements IZkusdGoverningCouncilClient {
  readonly trees: CouncilTreeProviders;
  readonly councilContract: ZkusdGoverningCouncilContract;

  txMgr: TransactionManager<any>;


  static withDataFromContractEvents(
    councilContract: ZkusdGoverningCouncilContract,
    txMgr: TransactionManager<any>,
  ) {
    const trees = {
      councilTree: CouncilTreeContractProvider.fromContract(councilContract),
      resolutionTree: ResolutionTreeContractProvider.fromContract(councilContract),
      proposalMap: ProposalMapContractProvider.fromContract(councilContract),
    };
    return new ZkusdGoverningCouncilClient(trees, councilContract, txMgr);
  }

  constructor(
    trees: CouncilTreeProviders,
    councilContract: ZkusdGoverningCouncilContract,
    txMgr: TransactionManager<any>
  ) {
    this.trees = trees;
    this.councilContract = councilContract;
    this.txMgr = txMgr;
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
      (await this.trees.resolutionTree.get()).getNextEmptyIndex();

    return ZkusdProtocolUpdateSpec.singleOperation(index, operation, {
      blockchainPreconditions: args.blockchainPreconditions,
    });
  }

  public async createVoteProof(args: {
    updateSpec: ZkusdProtocolUpdateSpec;
    signature: Signature;
    seat: number | bigint | UInt8 | PublicKey;
  }): Promise<ZkusdGoverningCouncilVoteProof> {
    const councilTree = await this.trees.councilTree.get();
    return await proveProposalSupport(args.updateSpec, args.signature, councilTree, args.seat)
  }

  public async mergeVoteProofs(
    leftVoteProof: ZkusdGoverningCouncilVoteProof,
    rightVoteProof: ZkusdGoverningCouncilVoteProof
  ): Promise<ZkusdGoverningCouncilVoteProof> {
    return (await MultiSigZkusdProtocolUpdateProgram.mergeVotes(
      leftVoteProof.publicInput,
      leftVoteProof,
      rightVoteProof
    )).proof;
  }

  public async submitVote(
    voteProof: ZkusdGoverningCouncilVoteProof,
    senderKeys: KeyPair,
    args?: {force?: boolean},
  ): Promise<ProposalUpdateResults> {

    const threshold = await this.councilContract.standardProposalPassThreshold.fetch();
    if (!threshold) {
      throw new Error('Could not fetch vote threshold from the contract');
    }

    // get the current off-chain data
    let proposalMap = await this.trees.proposalMap.get();
    const resolutionTree = await this.trees.resolutionTree.get();

    // check if the proof will actually do anything
    const onchainVoteBits = proposalMap.get(voteProof.publicOutput.proposalHash);
    const proofVoteBits = voteProof.publicOutput.cummulatedVoteBitArray;

    const newVoteBitArray = ProposalMap.sumVotesProvably(
      onchainVoteBits,
      proofVoteBits
    );

    const votesMissingBefore = clampZero(threshold.toBigInt() - newVoteBitArray.toBigInt());

    // if it doesnt then dont even try to submit unless force flag is set
    if (newVoteBitArray.lessThanOrEqual(onchainVoteBits).toBoolean() && !args?.force) {
      return {
        transactionIncluded: false,
        votesMissing: votesMissingBefore,
        info: `Tx not sent. Votes from this proofs are already included.`
      };
    }

    // if it does then the vote is submited
    const currentTimeInSeconds = Math.floor(Date.now() / 1000);
    let transactionIncluded = false;
    let info;
    try {
      const txh = await this.txMgr.tx(
        senderKeys,
        async () => {
          await this.councilContract.supportProposalHelper(
            voteProof,
            proposalMap,
            resolutionTree
          );
        },
        {
          name: `ZkUsd Governing Council Vote in support of proposal ${voteProof.publicOutput.proposalHash.toString()} (@${currentTimeInSeconds}`,
        }
      );
      await txh.awaitIncluded();
      transactionIncluded = true;
    } catch (e) {
      info = `Error: ${JSON.stringify(e)}`;
    }

    proposalMap = await this.trees.proposalMap.get();
    const currentSupport = proposalMap.getVoteCount(voteProof.publicOutput.proposalHash);
    const votesMissing = clampZero(threshold.toBigInt() - currentSupport.toBigInt());

    return {
      transactionIncluded,
      votesMissing,
      info,
    };
  }

  public async tryPassProposal(
    updateSpec: ZkusdProtocolUpdateSpec,
    senderKeys: KeyPair,
    opts?: { force?: boolean }
  ): Promise<ProposalUpdateResults> {

    const resolutionTree = await this.trees.resolutionTree.get();
    const resolutionWitness = resolutionTree.getWitnessWrapped(
      updateSpec.govResolutionIndex.toBigint()
    );
    let proposalMap = await this.trees.proposalMap.get();
    const updateHash = Poseidon.hash(updateSpec.toFields());
    const proposalWitness = proposalMap.getWitness(updateHash);
    const voteBits = proposalMap.get(updateHash);
    const threshold = await this.councilContract.standardProposalPassThreshold.fetch();
    if (!threshold) {
      throw new Error('Could not fetch vote threshold from the contract');
    }
    if (voteBits.toBigInt() < threshold.toBigInt() && !opts?.force) {
      return {
        transactionIncluded: false,
        votesMissing: clampZero(threshold.toBigInt() - voteBits.toBigInt()),
        info: `Proposal ${updateHash.toString()} has not enough votes to pass.`
      }
    }

    let included = false;
    let info;
    try {
      const txh = await this.txMgr.tx(senderKeys, async () => {
        await this.councilContract.passProposal(
          updateSpec,
          proposalWitness,
          voteBits,
          resolutionWitness
        );
      });
      await txh.awaitIncluded();
      included = true;
    } catch (e) {
      info = `Error: ${JSON.stringify(e)}`;
    }
    let votesMissing: bigint | undefined;
    if (!included) {
      // likely there are votes missing let's compute
      // no need to refresh, tx was not included
      proposalMap = await this.trees.proposalMap.get();
      const currentSupport = proposalMap.getVoteCount(updateHash);
      const threshold = await this.councilContract.standardProposalPassThreshold.fetch();

      votesMissing = threshold
        ? clampZero(threshold.toBigInt() - currentSupport.toBigInt())
        : undefined;
    } else {
      votesMissing = 0n;
    }

    return {
      transactionIncluded: included,
      votesMissing,
      info,
    }
  }

  /**
   * Apply a *passed* proposal (i.e. already voted-through and passed on-chain)
   * to the ZkUSD engine.  Every individual protocol-parameter change lives in
   * its own transaction so that a failure in one field does **not** revert the
   * others.
   *
   * A field is considered “live” when `fieldOp.isNoop()` is `false`.
   * The mapping `field → setter` is defined in `setterMap` below.
   */
  public async applyPassedProposalToEngine(
    updateSpec: ZkusdProtocolUpdateSpec,
    senderKeys: KeyPair,
  ): Promise<ProposalUpdateResults> {
    // -------------------------------------------------------------------------
    // 1. Build the witness once – it is reused for every setter call
    // -------------------------------------------------------------------------
    const resolutionTree = await this.trees.resolutionTree.get();
    const resolutionWitness: ResolutionTree.Witness =
      resolutionTree.getWitnessWrapped(updateSpec.govResolutionIndex.toBigint());

    // -------------------------------------------------------------------------
    // 2. Helper: map operation field → council-contract setter
    // -------------------------------------------------------------------------
    const setterMap: Partial<Record<keyof ZkusdProtocolUpdateOperation, keyof InstanceType<ReturnType<typeof ZkUsdEngineContract>>>> =
    {
      emergencyStop: 'govToggleEmergencyStop',
      vaultCreationDisabled: 'govToggleVaultCreation',
      collateralRatio: 'govUpdateCollateralRatio',
      validPriceBlockCount: 'govUpdateValidPriceBlockCount',
      liquidationBonusRatio: 'govUpdateLiquidationBonusRatio',
      oracleWhitelistHash: 'govUpdateOracleWhitelist',
      configMerkleRoot: 'govUpdateConfigMerkleRoot',
      newVerificationKey: 'govUpdateEngineVerificationKey',
      vaultDebtCeiling: 'govUpdateVaultDebtCeiling',
    };

    // -------------------------------------------------------------------------
    // 3. Iterate over every field, submit a tx for the non-noop ones
    // -------------------------------------------------------------------------
    const op = updateSpec.protocolUpdateOperation;
    const failed: string[] = [];
    let anySucceeded = false;

    for (const fieldName of Object.keys(setterMap) as Array<keyof typeof setterMap>) {
      const fieldOp = op[fieldName];

      if (!hasIsNoopMethod(fieldOp)) {
        throw new Error(
          `Protocol update field '${fieldName}' does not implement isNoop(). Make sure all update operations implement the isNoop(): Bool method.`
        );
      }
      if (fieldOp.isNoop().toBoolean()) continue;


      const setter = setterMap[fieldName];
      if (setter === undefined) {
        throw new Error(`Setter for field ${fieldName} not found in setterMap. It should be one of ${Object.keys(setterMap).join(', ')}. Is it outdated?`);
      }
      try {
        const txh = await this.txMgr.tx(
          senderKeys,
          async () => {
            await (this.councilContract as any)[setter](updateSpec, resolutionWitness);
          },
          { name: `Engine-update: ${String(setter)} for proposal ${updateSpec.govResolutionIndex.toString()}` }
        );
        await txh.awaitIncluded();
        anySucceeded = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${String(setter)} failed: ${msg}`);
      }
    }

    // -------------------------------------------------------------------------
    // 4. Compose result
    // -------------------------------------------------------------------------
    if (!anySucceeded && failed.length === 0) {
      // all ops were no-ops
      return {
        transactionIncluded: false,
        info: 'Nothing to apply – every operation in the proposal is a noop.',
      };
    }

    return {
      transactionIncluded: anySucceeded,
      info:
        failed.length > 0
          ? `Some updates failed:\n${failed.join('\n')}`
          : null,
    };
  }

  public async submitVoteAndTryPassAndApply(args: {
    voteProof: ZkusdGoverningCouncilVoteProof;
    senderKeys: KeyPair;
    opts?: { force?: boolean };
  }): Promise<ProposalUpdateResults> {
    const { voteProof, opts } = args;

    // Submit the vote
    const voteResult = await this.submitVote(
      voteProof,
      args.senderKeys,
      {force: opts?.force},
    );

    // If vote did nothing and not forced, short-circuit
    if (!voteResult.transactionIncluded && !opts?.force) {
      return voteResult;
    }

    // Retrieve updateSpec from the voteProof
    const updateSpec = voteProof.publicInput;

    // Try to pass the proposal
    const passResult = await this.tryPassProposal(updateSpec,
      args.senderKeys,
      {
        force: opts?.force,
      }
    );

    // If still not passed, return that result
    if (!passResult.transactionIncluded && !opts?.force) {
      return passResult;
    }

    // Apply the protocol change to the engine
    const applyResult = await this.applyPassedProposalToEngine(updateSpec, args.senderKeys);

    // Aggregate info
    const info =
      [voteResult.info, passResult.info, applyResult.info]
        .filter((i) => i)
        .join('\n') || null;

    return {
      transactionIncluded: voteResult.transactionIncluded || passResult.transactionIncluded || applyResult.transactionIncluded,
      votesMissing: passResult.votesMissing, // this is the most relevant one
      info,
    };
  }

}

function hasIsNoopMethod(op: unknown): op is { isNoop(): Bool } {
  return typeof op === 'object' && op !== null && typeof (op as any).isNoop === 'function';
}

function clampZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}
