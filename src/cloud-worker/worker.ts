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
import { ContractInstance } from '../types.js';
import { verificationKeys } from '../config/verification-keys.js';
import {
  deserializeTransaction,
  getMinaPriceInputFromJsonProof,
  transactionParams,
} from './transaction.js';

type ContractMethod =
  | 'createVault'
  | 'depositCollateral'
  | 'redeemCollateral'
  | 'mintZkUsd'
  | 'liquidate'
  | 'burnZkUsd';
type TransactionArgs = Record<string, any>;

interface TransactionConfig {
  method: ContractMethod;
  buildTx: (contract: any, args: TransactionArgs) => Promise<void>;
  requiresNewAccounts?: boolean;
}

export class zkUsdWorker extends zkCloudWorker {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  keys: NetworkKeyPairs;
  oracleAggregationVk: VerificationKey;
  vaultVk: VerificationKey;

  readonly cache: Cache;

  private readonly transactionConfigs: Record<
    ContractMethod,
    TransactionConfig
  > = {
    createVault: {
      method: 'createVault',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.createVault(PublicKey.fromBase58(args.vaultAddress));
      },
      requiresNewAccounts: true,
    },
    depositCollateral: {
      method: 'depositCollateral',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.depositCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.amount)
        );
      },
    },
    redeemCollateral: {
      method: 'redeemCollateral',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.redeemCollateral(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.amount),
          args.minaPriceInput as MinaPriceInput
        );
      },
    },
    burnZkUsd: {
      method: 'burnZkUsd',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.burnZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.amount)
        );
      },
    },
    mintZkUsd: {
      method: 'mintZkUsd',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.mintZkUsd(
          PublicKey.fromBase58(args.vaultAddress),
          UInt64.from(args.amount),
          args.minaPriceInput as MinaPriceInput
        );
      },
    },
    liquidate: {
      method: 'liquidate',
      buildTx: async (contract: typeof this.engine.contract, args) => {
        await contract.liquidate(
          PublicKey.fromBase58(args.vaultAddress),
          args.minaPriceInput as MinaPriceInput
        );
      },
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

    const args = JSON.parse(this.cloud.args);
    const config = this.transactionConfigs[this.cloud.task as ContractMethod];

    if (!config) {
      throw new Error(`Unknown task: ${this.cloud.task}`);
    }

    return await this.processTransaction(config, args, transactions);
  }

  private async processTransaction(
    config: TransactionConfig,
    args: TransactionArgs,
    txs: string[]
  ): Promise<string> {
    if (txs.length === 0) return 'No transactions to send';
    await this.compile();

    try {
      console.log('First');
      const { serializedTx, signedData } = JSON.parse(txs[0]);
      const signedJson = JSON.parse(signedData);
      const { fee, sender, nonce, memo } = transactionParams(
        serializedTx,
        signedJson
      );

      console.log('Creating transaction');

      if (args.minaPriceProof) {
        args.minaPriceInput = await getMinaPriceInputFromJsonProof(
          args.minaPriceProof as JsonProof,
          this.oracleAggregationVk as VerificationKey
        );
      }

      await fetchMinaAccount({
        publicKey: this.keys.engine.publicKey,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: sender,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: PublicKey.fromBase58(args.vaultAddress),
        tokenId: this.engine.contract.deriveTokenId(),
        force: true,
      });

      console.log('args', args);

      const txNew = await Mina.transaction(
        { sender, fee, nonce, memo },
        async () => {
          if (config.requiresNewAccounts && args.newAccounts > 0) {
            AccountUpdate.fundNewAccount(sender, args.newAccounts);
          }
          await config.buildTx(this.engine.contract, args);
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
}
