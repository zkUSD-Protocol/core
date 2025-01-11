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
} from 'o1js';
import {
  ZkUsdEngineContract,
  ZkUsdVault,
  ZkUsdMasterOracle,
  ZkUsdPriceTracker,
  FungibleTokenContract,
} from '../index.js';
import { getNetworkKeys, NetworkKeyPairs } from '../config/keys.js';
import { ContractInstance } from '../types.js';
import verificationKeys from '../config/verification-keys.json';
import { deserializeTransaction, transactionParams } from './transaction.js';

export class zkUsdWorker extends zkCloudWorker {
  static engineVerificationKey: VerificationKey | undefined = undefined;

  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  keys: NetworkKeyPairs;

  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
    this.keys = getNetworkKeys(this.cloud.chain);
  }

  private async compile(): Promise<string> {
    console.log('Compiling contracts');

    try {
      const vaultKey: VerificationKey = {
        data: verificationKeys.vault.data,
        hash: Field(verificationKeys.vault.hash),
      };

      if (!vaultKey) {
        throw new Error('Vault key not found');
      }

      const ZkUsdEngine = ZkUsdEngineContract(
        this.keys.token.publicKey,
        this.keys.masterOracle.publicKey,
        this.keys.evenOraclePriceTracker.publicKey,
        this.keys.oddOraclePriceTracker.publicKey,
        vaultKey
      );

      const FungibleToken = ZkUsdEngine.FungibleToken;

      if (zkUsdWorker.engineVerificationKey === undefined) {
        console.time('compiled zkUSD Contracts');

        await ZkUsdMasterOracle.compile();
        await ZkUsdPriceTracker.compile();
        await ZkUsdVault.compile();
        await FungibleToken.compile();

        zkUsdWorker.engineVerificationKey = (
          await ZkUsdEngine.compile()
        ).verificationKey;
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
    if (this.cloud.args === undefined)
      throw new Error('this.cloud.args is undefined');
    const args = JSON.parse(this.cloud.args);

    switch (this.cloud.task) {
      case 'sendVaultTx':
        if (transactions.length === 0)
          throw new Error('No transactions provided');
        return await this.sendVaultTx(args, transactions);

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private async sendVaultTx(
    args: Record<string, any>,
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

      const txNew = await Mina.transaction(
        {
          sender,
          fee,
          nonce,
          memo,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await this.engine.contract.createVault(
            PublicKey.fromBase58(args.vaultAddress)
          );
        }
      );

      const tx = deserializeTransaction(serializedTx, txNew, signedJson);

      console.time('proving');
      await tx.prove();
      console.timeEnd('proving');

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
    } catch (error) {
      console.error('Transaction failed:', error);
      throw new Error(
        `Failed to process transaction: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}
