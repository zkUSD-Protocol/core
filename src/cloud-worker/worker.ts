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
import { verificationKeys } from '../config/verification-keys.js';
import {
  deserializeTransaction,
  getMinaPriceInputFromJsonProof,
  transactionParams,
} from './transaction.js';

interface TransactionConfig<T extends VaultTransactionType> {
  method: T;
  buildTx: (
    args: VaultTransactionArgs[T],
    minaPriceInput?: MinaPriceInput
  ) => Promise<void>;
  requiresNewAccounts?: boolean;
  requiresPriceProof?: boolean;
}

export class zkUsdWorker extends zkCloudWorker {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  keys: NetworkKeyPairs;
  oracleAggregationVk: VerificationKey;
  vaultVk: VerificationKey;

  readonly cache: Cache;

  private readonly transactionConfigs: {
    [K in VaultTransactionType]: TransactionConfig<K>;
  } = {
    [VaultTransactionType.CREATE_VAULT]: {
      method: VaultTransactionType.CREATE_VAULT,
      buildTx: async (args: CreateVaultArgs) => {
        await this.engine.contract.createVault(
          PublicKey.fromBase58(args.vaultAddress)
        );
      },
      requiresNewAccounts: true,
    },
    [VaultTransactionType.DEPOSIT_COLLATERAL]: {
      method: VaultTransactionType.DEPOSIT_COLLATERAL,
      buildTx: async (args: CollateralAmountArgs) => {
        await this.engine.contract.depositCollateral(
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
        await this.engine.contract.redeemCollateral(
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
        await this.engine.contract.burnZkUsd(
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
        await this.engine.contract.mintZkUsd(
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
        await this.engine.contract.liquidate(
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
    this.keys = getNetworkKeys(this.cloud.chain);
  }

  private async compile(): Promise<string> {
    console.log('Compiling contracts');

    try {
      this.vaultVk = new VerificationKey(
        (await ZkUsdVault.compile()).verificationKey
      );

      console.log('Compiling oracle aggregation');

      this.oracleAggregationVk = new VerificationKey(
        (await AggregateOraclePrices.compile()).verificationKey
      );

      console.log('Compiled oracle aggregation');

      if (!this.vaultVk || !this.oracleAggregationVk) {
        throw new Error('Verification keys not found');
      }
      const ZkUsdEngine = ZkUsdEngineContract({
        zkUsdTokenAddress: this.keys.token.publicKey,
        minaPriceInputZkProgramVkHash: this.oracleAggregationVk.hash,
        vaultVerificationKey: this.vaultVk,
      });

      const FungibleToken = ZkUsdEngine.FungibleToken;

      if (!ZkUsdEngine._provers) {
        console.time('compiled zkUSD Contracts');
        await FungibleToken.compile();
        const engineVk = await ZkUsdEngine.compile();
        console.log('engineVk', engineVk.verificationKey.hash.toString());
        console.timeEnd('compiled zkUSD Contracts');
      } else {
        console.log('Contracts already compiled');
      }

      this.engine = {
        contract: new ZkUsdEngine(this.keys.engine.publicKey),
      };

      this.token = {
        contract: new FungibleToken(this.keys.token.publicKey),
      };

      return 'Contracts compiled';
    } catch (error) {
      console.error('Error in compile, restarting container', error);
      // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
      await this.cloud.forceWorkerRestart();

      return 'Error compiling contracts';
    }
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    console.log('Executing transaction');
    if (!this.cloud.args) throw new Error('this.cloud.args is undefined');
    if (transactions.length === 0) throw new Error('No transactions provided');

    const task = this.cloud.task as VaultTransactionType;
    const config = this.transactionConfigs[task] as TransactionConfig<
      typeof task
    >;
    const args = JSON.parse(
      this.cloud.args
    ) as VaultTransactionArgs[typeof task];

    if (!config) {
      throw new Error(`Unknown task: ${task}`);
    }

    return await this.processTransaction(config, args, transactions);
  }

  private async processTransaction<T extends VaultTransactionType>(
    config: TransactionConfig<T>,
    args: VaultTransactionArgs[T],
    txs: string[]
  ): Promise<string> {
    if (txs.length === 0) return 'No transactions to send';
    await this.compile();

    try {
      const { serializedTx, signedData } = JSON.parse(txs[0]);
      const signedJson = JSON.parse(signedData);
      const { fee, sender, nonce, memo } = transactionParams(
        serializedTx,
        signedJson
      );

      let minaPriceInput: MinaPriceInput | undefined;

      if (config.requiresPriceProof) {
        minaPriceInput = await getMinaPriceInputFromJsonProof(
          (args as PriceProofArgs).minaPriceProof,
          this.oracleAggregationVk
        );
      }

      await this.fetchLatestAccounts(sender, args.vaultAddress);

      const txNew = await Mina.transaction(
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

      console.log('txNew', txNew.toPretty());

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

  private async proveAndSendTx(
    serializedTx: string,
    txNew: Mina.Transaction<false, false>,
    signedJson: any
  ): Promise<string> {
    const tx = deserializeTransaction(serializedTx, txNew, signedJson);

    console.log('Proving the transaction');
    console.time('proved');

    try {
      // Create a promise that rejects after 2 minutes
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Proving timed out after 2 minutes')),
          2 * 60 * 1000
        );
      });

      // Race between the proof generation and timeout
      await Promise.race([tx.prove(), timeoutPromise]);
    } catch (error) {
      console.timeEnd('proved');
      console.error('Proving failed:', error);
      return (
        'Error: Transaction proving failed - ' +
        (error instanceof Error ? error.message : 'Unknown error')
      );
    }

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

  private async fetchLatestAccounts(sender: PublicKey, vaultAddress: string) {
    await fetchMinaAccount({
      publicKey: this.keys.engine.publicKey,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: PublicKey.fromBase58(vaultAddress),
      tokenId: this.engine.contract.deriveTokenId(),
      force: true,
    });
  }
}
