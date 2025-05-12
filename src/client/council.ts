import { MinaChainPreconditions } from '../system/engine-update/blockchain-preconditions.js';
import {
  EngineUpdateOperation,
  EngineUpdateOperationFields as EngineUpdateOperationFields,
} from '../system/engine-update/operation.js';
import { ZkusdProtocolPreconditions } from '../system/engine-update/protocol-preconditions.js';
import { Bool, Poseidon, Provable, provable, PublicKey, Signature, UInt8 } from 'o1js';
import { EngineUpdateSpec } from '../system/engine-update/input.js';
import { blockchain, KeyPair } from '../types/utility.js';
import { ZkusdGoverningCouncilContract } from '../contracts/zkusd-governing-council.js';
import { TransactionManager } from '../transaction/manager.js';
import { CouncilDataProvider } from '../system/council/data/data-provider.js';
import {
  EngineUpdate,
  EngineUpdateVoteProof,
} from '../proofs/engine-update/prove.js';
import { ProposalMap } from '../system/council/data/proposal-merkle-map.js';
import { ResolutionTree } from '../system/council/data/resolution-tree.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import {
  CouncilUpdateVoteInput,
} from '../system/council/update/input.js';
import {
  CouncilKeyWithIntent,
} from '../system/council/update/common.js';
import {
  CouncilUpdate,
  CouncilUpdateVoteProof,
} from '../proofs/council-update/prove.js';
import { Seat } from '../system/council/seat.js';
import { CouncilMap } from '../system/council/data/council-map.js';
import { MinaNetworkInterface } from '../mina/network-interface.js';
import { LocalTransactionExecutor } from '../transaction/local-executor.js';
import { getNetworkKeys } from '../config/keys.js';
import { AggregateOraclePrices } from '../proofs/oracle-price-aggregation/prove.js';

type UpdateResults = {
  transactionIncluded: boolean;
  votesMissing?: bigint;
  info?: string | null;
};
export interface EngineUpdateClient {
  createSpec(args: {
    operation: Partial<EngineUpdateOperationFields> | EngineUpdateOperation;
    protocolPreconditions: ZkusdProtocolPreconditions;
    blockchainPreconditions: MinaChainPreconditions;
  }): Promise<EngineUpdateSpec>;

  createVoteProof(args: {
    updateSpec: EngineUpdateSpec;
    signature: Signature;
    seat: Seat | PublicKey;
  }): Promise<EngineUpdateVoteProof>;

  mergeVoteProofs(
    leftVoteProof: EngineUpdateVoteProof,
    rightVoteProof: EngineUpdateVoteProof
  ): Promise<EngineUpdateVoteProof>;

  submitVote(
    voteProof: EngineUpdateVoteProof,
    senderKeys: KeyPair,
    args?: { force?: boolean }
  ): Promise<UpdateResults>;

  tryPassProposal(
    updateSpec: EngineUpdateSpec,
    senderKeys: KeyPair,
    opts?: { force?: boolean }
  ): Promise<UpdateResults>;

  applyPassedProposal(
    updateSpec: EngineUpdateSpec,
    senderKeys: KeyPair
  ): Promise<UpdateResults>;

  submitVoteAndTryPassAndApply(args: {
    voteProof: EngineUpdateVoteProof;
    senderKeys: KeyPair;
    opts?: { force?: boolean };
  }): Promise<UpdateResults>;
}

export interface CouncilUpdateClient {
  createInput(args: {
    intents: CouncilKeyWithIntent[];
    newVoteThreshold: UInt8;
  }): Promise<CouncilUpdateVoteInput>;

  createVoteProof(args: {
    input: CouncilUpdateVoteInput;
    signature: Signature;
    seat: Seat | PublicKey;
  }): Promise<CouncilUpdateVoteProof>;

  mergeVoteProofs(
    leftVoteProof: CouncilUpdateVoteProof,
    rightVoteProof: CouncilUpdateVoteProof
  ): Promise<CouncilUpdateVoteProof>;

  executeCouncilUpdate(
    voteProof: CouncilUpdateVoteProof,
    senderKeys: KeyPair,
    args?: { force?: boolean }
  ): Promise<UpdateResults>;
}

export interface IZkusdGoverningCouncilClient {
  readonly data: CouncilDataProvider;
  readonly engineContract: InstanceType<ReturnType<typeof ZkUsdEngineContract>>;
  readonly councilContract: ZkusdGoverningCouncilContract;

  engineUpdate: EngineUpdateClient;
  councilUpdate: CouncilUpdateClient;
}

// todo remove implementation from the main class and move them into the smaller interfaces
// implement the council update interface
export class ZkusdGoverningCouncilClient
  implements IZkusdGoverningCouncilClient
{
  private _engineUpdateProverCompiled: boolean = false;
  private _councilUpdateProverCompiled: boolean = false;
  private _councilContractCompiled: boolean = false;
  private _engineContractClass: ReturnType<typeof ZkUsdEngineContract>;
  private _engineContractCompiled: boolean = false;
  // Implement interface field
  public get engineUpdate(): EngineUpdateClient {
    return this.engineUpdateImpl;
  }
  public get councilUpdate(): CouncilUpdateClient {
    return this.councilUpdateImpl;
  }
  readonly data: CouncilDataProvider;
  readonly councilContract: ZkusdGoverningCouncilContract;
  readonly engineContract: InstanceType<ReturnType<typeof ZkUsdEngineContract>>;

  txMgr: TransactionManager<any>;

  private async compileEngineUpdateProver() {
    if (!this._engineUpdateProverCompiled) {
      await EngineUpdate.compile();
      this._engineUpdateProverCompiled = true;
    }
  }

  private async compileCouncilUpdateProver() {
    if (!this._councilUpdateProverCompiled) {
      await CouncilUpdate.compile();
      this._councilUpdateProverCompiled = true;
    }
  }

  private async compileCouncilContract() {
    if (!this._councilContractCompiled) {
      await this.compileCouncilUpdateProver();
      await this.compileEngineUpdateProver();
      await ZkusdGoverningCouncilContract.compile();
      this._councilContractCompiled = true;
    }
  }

  private async compileEngineContract() {
    if (!this._engineContractCompiled) {
      await this._engineContractClass.compile();
      this._engineContractCompiled = true;
    }
  }

  // --- EngineUpdateClient interface adapter ---
  private engineUpdateImpl: EngineUpdateClient = {
    createSpec: this.createEngineUpdateSpec.bind(this),
    createVoteProof: this.createEngineUpdateVoteProof.bind(this),
    mergeVoteProofs: this.mergeEngineUpdateVoteProofs.bind(this),
    submitVote: this.submitEngineUpdateVote.bind(this),
    tryPassProposal: this.tryPassEngineUpdateProposal.bind(this),
    applyPassedProposal: this.applyPassedUpdateToEngine.bind(this),
    submitVoteAndTryPassAndApply:
      this.submitEngineUpdateVoteAndTryPassAndApply.bind(this),
  };

  // --- CouncilUpdateClient stub ---
  private councilUpdateImpl: CouncilUpdateClient = {
    createInput: this.createCouncilUpdateInput.bind(this),
    createVoteProof: this.createCouncilUpdateVoteProof.bind(this),
    mergeVoteProofs: this.mergeCouncilUpdateVoteProofs.bind(this),
    executeCouncilUpdate: this.executeCouncilUpdate.bind(this),
  };

  static async default(
    chain: blockchain,
  ) {
    const mina = await MinaNetworkInterface.initChain(chain);
    const txMgr = TransactionManager.new(mina,{local: new LocalTransactionExecutor(), default:'local'});
    // fetch the contract account public key
    const address = getNetworkKeys(chain).government;
    if(!address){
      throw new Error("Could not access council contract address.");
    }
    const contract = new ZkusdGoverningCouncilContract(address.publicKey);
    const fetchCurrentBlockHeight = async () => {
      // const ret = txMgr.mina.getNetworkState().blockchainLength; //
      return undefined;
    };
    const engineAddress = getNetworkKeys(chain).engine;
    if(!engineAddress){
      throw new Error("Could not access engine contract address.");
    }

    const tokenAddress = getNetworkKeys(chain).token;
    if(!tokenAddress){
      throw new Error("Could not access token contract address.");
    }

    const oracleAggCompiled = await AggregateOraclePrices.compile();
    const oracleAggregationVkh = oracleAggCompiled.verificationKey.hash;


      // zkUsdTokenAddress: this._networkKeys.token.publicKey,
      // minaPriceInputZkProgramVkHash: this._oracleAggregationVk.hash,
      // zkUsdGovernmentAddress: this._networkKeys.government.publicKey,
      // GovernmentClass: ZkusdGoverningCouncilContract,
    const ZkusdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: tokenAddress.publicKey,
      minaPriceInputZkProgramVkHash: oracleAggregationVkh,
      zkUsdGovernmentAddress: address.publicKey,
      GovernmentClass: ZkusdGoverningCouncilContract,
    });
    const engine = new ZkusdEngine(engineAddress.publicKey);
    return new ZkusdGoverningCouncilClient(
      CouncilDataProvider.fromContractEvents(
        contract,
        fetchCurrentBlockHeight
      ),
      contract,
      engine,
      ZkusdEngine,
      txMgr
    );
  }

  constructor(
    data: CouncilDataProvider,
    councilContract: ZkusdGoverningCouncilContract,
    engineContract: InstanceType<ReturnType<typeof ZkUsdEngineContract>>,
    engineContractClass: ReturnType<typeof ZkUsdEngineContract>,
    txMgr: TransactionManager<any>
  ) {
    this.data = data;
    this.councilContract = councilContract;
    this.engineContract = engineContract;
    this._engineContractClass = engineContractClass;
    this.txMgr = txMgr;
  }

  private async getVoterAndSeat(
    seat: Seat | PublicKey,
    councilMap: CouncilMap
  ): Promise<{
    voter: PublicKey;
    seatFinal: Seat;
  }> {
    let voter: PublicKey;
    let seatFinal: Seat;
    if (seat instanceof PublicKey) {
      voter = seat;
      seatFinal = councilMap.getPubkeySeatKey(voter)!;
    } else {
      seatFinal = seat;
      voter = councilMap.getSeatPublicKey(seatFinal)!;
    }
    // debug information about seat
     // if seat is not found throw error
    if (!seatFinal || !voter) {
      throw new Error('Could not find seat or voter');
    }
    return { voter, seatFinal };
  }

  private async getThreshold() {
    const threshold = await this.councilContract.votePassThreshold.fetch();
    if (!threshold) {
      throw new Error('Could not fetch vote threshold from the contract');
    }
    return threshold;
  }

  public async createCouncilUpdateInput(args: {
    intents: CouncilKeyWithIntent[];
    newVoteThreshold: UInt8;
  }): Promise<CouncilUpdateVoteInput> {
    return CouncilUpdateVoteInput.createFromIntentsWithThreshold(
      await this.data.councilMap.get(),
      args.newVoteThreshold,
      args.intents
    );
  }

  public async createCouncilUpdateVoteProof(args: {
    input: CouncilUpdateVoteInput;
    signature: Signature;
    seat: Seat | PublicKey;
  }): Promise<CouncilUpdateVoteProof> {
    const councilMap = await this.data.councilMap.get();
    const { voter, seatFinal } = await this.getVoterAndSeat(
      args.seat,
      councilMap
    );

    const voteProof = await CouncilUpdate.createVote(
      args.input,
      args.signature,
      voter,
      seatFinal
    );

    return voteProof.proof as CouncilUpdateVoteProof;
  }

  public async mergeCouncilUpdateVoteProofs(
    leftVoteProof: CouncilUpdateVoteProof,
    rightVoteProof: CouncilUpdateVoteProof
  ): Promise<CouncilUpdateVoteProof> {
    return (
      await CouncilUpdate.mergeVotes(
        leftVoteProof.publicInput,
        leftVoteProof,
        rightVoteProof
      )
    ).proof as CouncilUpdateVoteProof;
  }

  public async executeCouncilUpdate(
    voteProof: CouncilUpdateVoteProof,
    senderKeys: KeyPair,
    args?: { force?: boolean }
  ): Promise<UpdateResults> {
    const threshold = await this.getThreshold();

    const proofVoteCount = ProposalMap.countBits(
      voteProof.publicOutput.cummulatedVoteBitArray
    );

    if (proofVoteCount.lessThanOrEqual(threshold).toBoolean() && !args?.force) {
      return {
        transactionIncluded: false,
        votesMissing: clampZero(
          threshold.toBigInt() - proofVoteCount.toBigInt()
        ),
        info: `Tx not sent. You only have ${proofVoteCount.toString()} votes. Threshold is ${threshold.toString()}.`,
      };
    }

    try {
      const txh = await this.txMgr.tx(senderKeys, async () => {
        await this.councilContract.executeCouncilUpdateActions(voteProof);
      });
      await txh.awaitIncluded();
      return { transactionIncluded: true, info: null };
    } catch (e) {
      return {
        transactionIncluded: false,
        info: `Error: ${JSON.stringify(e)}`,
      };
    }
  }

  public async createEngineUpdateSpec(args: {
    operation: Partial<EngineUpdateOperationFields> | EngineUpdateOperation;
    protocolPreconditions: ZkusdProtocolPreconditions;
    blockchainPreconditions: MinaChainPreconditions;
  }): Promise<EngineUpdateSpec> {
    let operation: EngineUpdateOperation;

    if ('protocolUpdateOperation' in args.operation) {
      // Already a EngineUpdateOperation
      operation = args.operation as EngineUpdateOperation;
    } else {
      // Build from partial fields
      operation = EngineUpdateOperation.create(args.operation);
    }
    const index = (await this.data.resolutionTree.get()).getNextEmptyIndex();

    return EngineUpdateSpec.singleOperation(index, operation, {
      blockchainPreconditions: args.blockchainPreconditions,
    });
  }

  public async createEngineUpdateVoteProof(args: {
    updateSpec: EngineUpdateSpec;
    signature: Signature;
    seat: Seat | PublicKey;
  }): Promise<EngineUpdateVoteProof> {
    await this.compileEngineUpdateProver();
    const councilMap = await this.data.councilMap.get();
    const { voter, seatFinal } = await this.getVoterAndSeat(
      args.seat,
      councilMap
    );
    return (
      await EngineUpdate.createVote(
        args.updateSpec,
        args.signature,
        voter,
        councilMap.provable,
        seatFinal
      )
    ).proof as EngineUpdateVoteProof;
  }

  public async mergeEngineUpdateVoteProofs(
    leftVoteProof: EngineUpdateVoteProof,
    rightVoteProof: EngineUpdateVoteProof
  ): Promise<EngineUpdateVoteProof> {
    await this.compileEngineUpdateProver();
    return (
      await EngineUpdate.mergeVotes(
        leftVoteProof.publicInput,
        leftVoteProof,
        rightVoteProof
      )
    ).proof;
  }

  public async submitEngineUpdateVote(
    voteProof: EngineUpdateVoteProof,
    senderKeys: KeyPair,
    args?: { force?: boolean }
  ): Promise<UpdateResults> {
    await this.compileCouncilContract();
    const threshold = await this.getThreshold();

    // get the current off-chain data
    let proposalMap = await this.data.proposalMap.get();
    const resolutionTree = await this.data.resolutionTree.get();

    // check if the proof will actually do anything
    const onchainVoteBits = proposalMap.get(
      voteProof.publicOutput.cummulatedVoteBitArray
    );
    const proofVoteBits = voteProof.publicOutput.cummulatedVoteBitArray;

    const newVoteBitArray = ProposalMap.sumVotesProvably(
      onchainVoteBits,
      proofVoteBits
    );

    const votesMissingBefore = clampZero(
      threshold.toBigInt() - newVoteBitArray.toBigInt()
    );

    // if it doesnt then dont even try to submit unless force flag is set
    if (
      newVoteBitArray.lessThanOrEqual(onchainVoteBits).toBoolean() &&
      !args?.force
    ) {
      return {
        transactionIncluded: false,
        votesMissing: votesMissingBefore,
        info: `Tx not sent. Votes from this proofs are already included.`,
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

    proposalMap = await this.data.proposalMap.get();
    const currentSupport = proposalMap.getVoteCount(
      voteProof.publicOutput.proposalHash
    );
    const votesMissing = clampZero(
      threshold.toBigInt() - currentSupport.toBigInt()
    );

    return {
      transactionIncluded,
      votesMissing,
      info,
    };
  }

  public async tryPassEngineUpdateProposal(
    updateSpec: EngineUpdateSpec,
    senderKeys: KeyPair,
    opts?: { force?: boolean }
  ): Promise<UpdateResults> {
    await this.compileCouncilContract();
    const resolutionTree = await this.data.resolutionTree.get();
    const resolutionWitness = resolutionTree.getWitnessWrapped(
      updateSpec.govResolutionIndex.toBigint()
    );
    let proposalMap = await this.data.proposalMap.get();
    const updateHash = Poseidon.hash(updateSpec.toFields());
    const proposalWitness = proposalMap.getWitness(updateHash);
    const voteBits = proposalMap.get(updateHash);
    const threshold = await this.councilContract.votePassThreshold.fetch();
    if (!threshold) {
      throw new Error('Could not fetch vote threshold from the contract');
    }
    if (voteBits.toBigInt() < threshold.toBigInt() && !opts?.force) {
      return {
        transactionIncluded: false,
        votesMissing: clampZero(threshold.toBigInt() - voteBits.toBigInt()),
        info: `Proposal ${updateHash.toString()} has not enough votes to pass.`,
      };
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
      proposalMap = await this.data.proposalMap.get();
      const currentSupport = proposalMap.getVoteCount(updateHash);
      const threshold = await this.councilContract.votePassThreshold.fetch();

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
    };
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
  public async applyPassedUpdateToEngine(
    updateSpec: EngineUpdateSpec,
    senderKeys: KeyPair
  ): Promise<UpdateResults> {
    await this.compileEngineContract();
    await this.compileCouncilContract();
    // -------------------------------------------------------------------------
    // 1. Build the witness once – it is reused for every setter call
    // -------------------------------------------------------------------------
    const resolutionTree = await this.data.resolutionTree.get();
    const resolutionWitness: ResolutionTree.Witness =
      resolutionTree.getWitnessWrapped(
        updateSpec.govResolutionIndex.toBigint()
      );

    // -------------------------------------------------------------------------
    // 2. Helper: map operation field → council-contract setter
    // -------------------------------------------------------------------------
    const setterMap: Partial<
      Record<
        keyof EngineUpdateOperation,
        keyof InstanceType<ReturnType<typeof ZkUsdEngineContract>>
      >
    > = {
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

    for (const fieldName of Object.keys(setterMap) as Array<
      keyof typeof setterMap
    >) {
      const fieldOp = op[fieldName];

      if (!hasIsNoopMethod(fieldOp)) {
        throw new Error(
          `Protocol update field '${fieldName}' does not implement isNoop(). Make sure all update operations implement the isNoop(): Bool method.`
        );
      }
      if (fieldOp.isNoop().toBoolean()) continue;

      const setter = setterMap[fieldName];
      if (setter === undefined) {
        throw new Error(
          `Setter for field ${fieldName} not found in setterMap. It should be one of ${Object.keys(setterMap).join(', ')}. Is it outdated?`
        );
      }
      try {
        const txh = await this.txMgr.tx(
          senderKeys,
          async () => {
            await (this.engineContract as any)[setter](
              updateSpec,
              resolutionWitness
            );
          },
          {
            name: `Engine-update: ${String(setter)} for proposal ${updateSpec.govResolutionIndex.toString()}`,
          }
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
        failed.length > 0 ? `Some updates failed:\n${failed.join('\n')}` : null,
    };
  }

  public async submitEngineUpdateVoteAndTryPassAndApply(args: {
    voteProof: EngineUpdateVoteProof;
    senderKeys: KeyPair;
    opts?: { force?: boolean };
  }): Promise<UpdateResults> {
    const { voteProof, opts } = args;

    // Submit the vote
    const voteResult = await this.submitEngineUpdateVote(
      voteProof,
      args.senderKeys,
      { force: opts?.force }
    );

    // If vote did nothing and not forced, short-circuit
    if (!voteResult.transactionIncluded && !opts?.force) {
      return voteResult;
    }

    // Retrieve updateSpec from the voteProof
    const updateSpec = voteProof.publicInput;

    // Try to pass the proposal
    const passResult = await this.tryPassEngineUpdateProposal(
      updateSpec,
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
    const applyResult = await this.applyPassedUpdateToEngine(
      updateSpec,
      args.senderKeys
    );

    // Aggregate info
    const info =
      [voteResult.info, passResult.info, applyResult.info]
        .filter((i) => i)
        .join('\n') || null;

    return {
      transactionIncluded:
        voteResult.transactionIncluded ||
        passResult.transactionIncluded ||
        applyResult.transactionIncluded,
      votesMissing: passResult.votesMissing, // this is the most relevant one
      info,
    };
  }
}

function hasIsNoopMethod(op: unknown): op is { isNoop(): Bool } {
  return (
    typeof op === 'object' &&
    op !== null &&
    typeof (op as any).isNoop === 'function'
  );
}

function clampZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}
