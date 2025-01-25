import {
  zkCloudWorker,
  Cloud,
  fee,
  sleep,
  deserializeFields,
  fetchMinaAccount,
  accountBalanceMina,
} from 'zkcloudworker';
import {
  verify,
  JsonProof,
  VerificationKey,
  PublicKey,
  Mina,
  PrivateKey,
  AccountUpdate,
  Cache,
  Field,
  UInt64,
  UInt32,
  Account,
} from 'o1js';
import {
  ZkUsdEngineContract,
  ZkUsdVault,
  FungibleTokenContract,
  validPriceBlockCount,
  AggregateOraclePrices,
  MinaPriceInput,
  AggregateOraclePricesProof,
} from '../index.js';
import { getNetworkKeys, NetworkKeyPairs } from '../config/keys.js';
import {
  CollateralAmountAndPriceProofArgs,
  CollateralAmountArgs,
  ContractInstance,
  CreateVaultArgs,
  PriceProofArgs,
  VaultTransactionArgs,
  VaultTransactionType,
  ZkUSDAmountAndPriceProofArgs,
  ZkUSDAmountArgs,
} from '../types.js';
import { TransactionManager } from '../mina/transaction-manager.js';
import { MinaNetworkInterface } from '../mina/mina-network-interface.js';

interface TransactionConfig<T extends VaultTransactionType> {
  method: T;
  buildTx: (
    args: VaultTransactionArgs[T],
    minaPriceInput?: MinaPriceInput
  ) => Promise<void>;
  requiresNewAccounts?: boolean;
  requiresPriceProof?: boolean;
}

type ZkUsdEngine = ReturnType<typeof ZkUsdEngineContract>;
type FungibleToken = ReturnType<typeof FungibleTokenContract>;

/**
 * ZkUsdCloudWorker extends the base zkCloudWorker to handle ZkUSD-specific operations.
 * It manages vault operations, token operations, and transaction processing from the frontend
 * through a cloud serverless environment.
 */
export class ZkUsdCloudWorker extends zkCloudWorker {
  private _engine: InstanceType<ZkUsdEngine>;
  private _token: InstanceType<FungibleToken>;
  private _keys: NetworkKeyPairs;

  // Static verification keys and contract instances are shared across all worker instances
  static vaultVk: VerificationKey | undefined = undefined;
  static oracleAggregationVk: VerificationKey | undefined = undefined;
  static engineVk: VerificationKey | undefined = undefined;
  static tokenVk: VerificationKey | undefined = undefined;

  // Contract class definitions
  static ZkUsdEngine: ZkUsdEngine | undefined = undefined;
  static FungibleToken: FungibleToken | undefined = undefined;

  // Transaction manager instance for handling all Mina transactions
  static txMgr: TransactionManager | undefined = undefined;

  readonly cache: Cache;

  /**
   * Configuration map for different vault transaction types.
   * Each configuration defines:
   * - method: The transaction type
   * - buildTx: Function to construct the transaction
   * - requiresNewAccounts: Whether new accounts need to be created
   * - requiresPriceProof: Whether a price proof is needed for the operation
   */
  private readonly transactionConfigs: {
    [K in VaultTransactionType]: TransactionConfig<K>;
  } = {
    [VaultTransactionType.CREATE_VAULT]: {
      method: VaultTransactionType.CREATE_VAULT,
      buildTx: async (args: CreateVaultArgs) => {
        await this._engine.createVault(PublicKey.fromBase58(args.vaultAddress));
      },
      requiresNewAccounts: true,
    },
    [VaultTransactionType.DEPOSIT_COLLATERAL]: {
      method: VaultTransactionType.DEPOSIT_COLLATERAL,
      buildTx: async (args: CollateralAmountArgs) => {
        await this._engine.depositCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.collateralAmount)
        );
      },
    },
    [VaultTransactionType.REDEEM_COLLATERAL]: {
      method: VaultTransactionType.REDEEM_COLLATERAL,
      buildTx: async (
        args: CollateralAmountAndPriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await this._engine.redeemCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.collateralAmount),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },
    [VaultTransactionType.BURN_ZKUSD]: {
      method: VaultTransactionType.BURN_ZKUSD,
      buildTx: async (args: ZkUSDAmountArgs) => {
        await this._engine.burnZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.zkusdAmount)
        );
      },
    },
    [VaultTransactionType.MINT_ZKUSD]: {
      method: VaultTransactionType.MINT_ZKUSD,
      buildTx: async (
        args: ZkUSDAmountAndPriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await this._engine.mintZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.zkusdAmount),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },
    [VaultTransactionType.LIQUIDATE]: {
      method: VaultTransactionType.LIQUIDATE,
      buildTx: async (
        args: PriceProofArgs,
        minaPriceInput?: MinaPriceInput
      ) => {
        await this._engine.liquidate(
          PublicKey.fromBase58(args.vaultAddress),
          minaPriceInput!
        );
      },
      requiresPriceProof: true,
    },
  };

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
    this._keys = getNetworkKeys(this.cloud.chain);
  }

  /**
   * Verifies and converts a JSON proof into a MinaPriceInput instance.
   * This is used for operations that require price verification.
   */
  private async getMinaPriceInputFromJsonProof(
    jsonProof: JsonProof
  ): Promise<MinaPriceInput> {
    const proof = (await AggregateOraclePricesProof.fromJSON(
      jsonProof as JsonProof
    )) as AggregateOraclePricesProof;

    const ok = await verify(proof, ZkUsdCloudWorker.oracleAggregationVk!);
    if (!ok) throw new Error('Proof verification failed');

    return new MinaPriceInput({
      proof,
      verificationKey: ZkUsdCloudWorker.oracleAggregationVk!,
    });
  }

  /**
   * Initializes the transaction manager with the appropriate network interface.
   * This is called once per worker instance.
   */
  private async initTxMgr() {
    const MinaChain = await MinaNetworkInterface.initChain(this.cloud.chain);
    if (!MinaChain) throw new Error('MinaChain not found');
    ZkUsdCloudWorker.txMgr = TransactionManager.new(MinaChain);
  }

  /**
   * Compiles all necessary contracts and verification keys.
   * This is a heavy operation that's performed once and cached.
   */
  private async compile(): Promise<string> {
    console.time('Compiling contracts');
    try {
      // Compile and cache verification keys
      if (ZkUsdCloudWorker.vaultVk === undefined) {
        ZkUsdCloudWorker.vaultVk = new VerificationKey(
          (await ZkUsdVault.compile({ cache: this.cache })).verificationKey
        );
      }

      if (ZkUsdCloudWorker.oracleAggregationVk === undefined) {
        ZkUsdCloudWorker.oracleAggregationVk = new VerificationKey(
          (await AggregateOraclePrices.compile()).verificationKey
        );
      }
      if (!ZkUsdCloudWorker.vaultVk || !ZkUsdCloudWorker.oracleAggregationVk) {
        throw new Error('Verification keys not found');
      }

      if (ZkUsdCloudWorker.ZkUsdEngine === undefined) {
        ZkUsdCloudWorker.ZkUsdEngine = ZkUsdEngineContract({
          zkUsdTokenAddress: this._keys.token.publicKey,
          minaPriceInputZkProgramVkHash:
            ZkUsdCloudWorker.oracleAggregationVk.hash,
          vaultVerificationKey: ZkUsdCloudWorker.vaultVk,
        });
      }

      if (ZkUsdCloudWorker.FungibleToken === undefined) {
        ZkUsdCloudWorker.FungibleToken =
          ZkUsdCloudWorker.ZkUsdEngine.FungibleToken;
      }

      if (ZkUsdCloudWorker.tokenVk === undefined) {
        ZkUsdCloudWorker.tokenVk = (
          await ZkUsdCloudWorker.FungibleToken.compile()
        ).verificationKey;
      }

      if (ZkUsdCloudWorker.engineVk === undefined) {
        ZkUsdCloudWorker.engineVk = (
          await ZkUsdCloudWorker.ZkUsdEngine.compile()
        ).verificationKey;
      }

      this._engine = new ZkUsdCloudWorker.ZkUsdEngine(
        this._keys.engine.publicKey
      );

      this._token = new ZkUsdCloudWorker.FungibleToken(
        this._keys.token.publicKey
      );

      console.timeEnd('Compiling contracts');
      return 'Contracts compiled';
    } catch (error) {
      console.error('Error in compile, restarting container', error);
      // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
      await this.cloud.forceWorkerRestart();

      return 'Error compiling contracts';
    }
  }

  /**
   * Main entry point for executing transactions.
   * Processes incoming transaction requests based on their type and configuration.
   */
  public async execute(transactions: string[]): Promise<string | undefined> {
    console.log('Executing transaction');
    if (!this.cloud.args) throw new Error('this.cloud.args is undefined');
    if (transactions.length === 0) throw new Error('No transactions provided');

    // Ensure transaction manager is initialized
    if (ZkUsdCloudWorker.txMgr === undefined) {
      await this.initTxMgr();
    }

    const task = this.cloud.task as VaultTransactionType;
    const config = this.transactionConfigs[task] as TransactionConfig<
      typeof task
    >;
    const args = JSON.parse(
      this.cloud.args
    ) as VaultTransactionArgs[typeof task];

    if (!config) throw new Error(`Unknown task: ${task}`);

    return await this.processTransaction(config, args, transactions);
  }

  /**
   * Processes a single transaction based on its configuration.
   * Handles the entire lifecycle from deserialization to execution.
   */
  private async processTransaction<T extends VaultTransactionType>(
    config: TransactionConfig<T>,
    args: VaultTransactionArgs[T],
    txs: string[]
  ): Promise<string> {
    if (txs.length === 0) return 'No transactions to send';
    await this.compile();

    try {
      // Parse and extract transaction details
      const { serializedTx, signedData } = JSON.parse(txs[0]);
      const signedJson = JSON.parse(signedData);
      const { fee, sender, nonce, memo } =
        ZkUsdCloudWorker.txMgr!.getTransactionParams(serializedTx, signedJson);

      // Handle price proof if required
      let minaPriceInput: MinaPriceInput | undefined;
      if (config.requiresPriceProof) {
        minaPriceInput = await this.getMinaPriceInputFromJsonProof(
          (args as PriceProofArgs).minaPriceProof
        );
      }

      // Ensure accounts are up to date
      await this.fetchLatestAccounts(sender, args.vaultAddress);

      // Build the transaction
      const txNew = await ZkUsdCloudWorker.txMgr!.mina.transaction(
        { sender, fee, nonce, memo },
        async () => {
          if (config.requiresNewAccounts) {
            AccountUpdate.fundNewAccount(
              sender,
              (args as CreateVaultArgs).newAccounts
            );
          }
          await config.buildTx(args, minaPriceInput);
        }
      );

      return await this.proveAndSendTx(serializedTx, txNew, signedJson);
    } catch (error) {
      console.error('Transaction failed:', error);
      throw new Error(
        `Failed to process transaction: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Handles the final steps of transaction processing:
   * 1. Proving the transaction
   * 2. Sending it to the network
   * 3. Publishing metadata
   */
  private async proveAndSendTx(
    serializedTx: string,
    txNew: Mina.Transaction<false, false>,
    signedJson: any
  ): Promise<string> {
    const tx = ZkUsdCloudWorker.txMgr!.deserializeTransaction(
      serializedTx,
      txNew,
      signedJson
    );

    console.log('Proving the transaction');

    /**
     * TODO: We need to figure out a way to timeout if the proof takes too long
     * Right now it sometimes hangs, and we cant use a promise that rejects after 2 minutes
     * because the proving hogs the CPU
     */
    console.time('proved');
    await tx.prove();
    console.timeEnd('proved');

    const txSent = await tx.safeSend();
    if (txSent.status === 'pending') {
      console.log(`tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
    } else {
      console.log(
        `tx NOT sent: hash: ${txSent?.hash} status: ${
          txSent?.status
        } errors: ${txSent.errors.join(', ')}`
      );
      return 'Error sending transaction';
    }

    if (this.cloud.isLocalCloud && txSent?.status === 'pending') {
      const txIncluded = await txSent.safeWait();
      console.log(
        `one tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
      );
      console.log('txIncluded', txIncluded);
      return txIncluded.hash;
    }

    if (txSent?.hash)
      this.cloud.publishTransactionMetadata({
        txId: txSent?.hash,
        metadata: {
          method: 'send',
        } as any,
      });
    return txSent?.hash ?? 'Error sending transaction';
  }

  /**
   * Ensures all relevant accounts are fetched with their latest state.
   * This includes the engine account, sender account, and vault account.
   */
  private async fetchLatestAccounts(sender: PublicKey, vaultAddress: string) {
    await fetchMinaAccount({
      publicKey: this._keys.engine.publicKey,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: PublicKey.fromBase58(vaultAddress),
      tokenId: this._engine.deriveTokenId(),
      force: true,
    });
  }
}
