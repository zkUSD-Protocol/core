import { PrivateKey, PublicKey, UInt64 } from 'o1js';
import { MinaNetworkInterface } from '../mina/network-interface.js';
import { MinaPriceInput } from '../proofs/oracle-price-aggregation/index.js';
import { HttpClientProver } from '../provers/httpclientprover.js';
import { ExternalTransactionExecutor } from '../transaction/external-executor.js';
import {
  TransactionHandle,
  TransactionManager,
  TransactionOptions,
} from '../transaction/manager.js';
import { blockchain } from '../types/utility.js';
import { FungibleTokenContract } from '@minatokens/token';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import { verificationKeys } from '../config/verification-keys.js';
import {
  TransactionArgs,
  ZkusdEngineTransactionType,
  ZkusdEngineTransactionArgs,
} from '../system/transaction.js';
import { VaultState, Vault } from '../system/vault.js';

interface ZKUSDClientConfig {
  chain: blockchain;
  httpProver: string;
  engineAddress: string;
  tokenAddress: string;
}

interface TransactionContext {
  sender: PublicKey;
  vaultAddress: string;
  amount?: UInt64;
  minaPriceInput?: MinaPriceInput;
  newAccounts?: number;
}

export class ZKUSDClient {
  private txMgr: TransactionManager<'executor'>;
  private engine: InstanceType<ReturnType<typeof ZkUsdEngineContract>>;
  private token: InstanceType<ReturnType<typeof FungibleTokenContract>>;

  constructor(
    txMgr: TransactionManager<'executor'>,
    engine: InstanceType<ReturnType<typeof ZkUsdEngineContract>>,
    token: InstanceType<ReturnType<typeof FungibleTokenContract>>
  ) {
    this.txMgr = txMgr;
    this.engine = engine;
    this.token = token;
  }

  static async create(config: ZKUSDClientConfig) {
    const { chain, httpProver, engineAddress, tokenAddress } = config;
    const mina = await MinaNetworkInterface.initChain(chain);
    const prover = new HttpClientProver(httpProver);
    const executor = await ExternalTransactionExecutor.start(mina, {
      prover,
    });
    const txMgr = TransactionManager.new(mina, {
      executor,
    });

    const ZkUsdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: PublicKey.fromBase58(tokenAddress),
      minaPriceInputZkProgramVkHash: verificationKeys.oracleAggregation.hash,
    });

    const FungibleToken = ZkUsdEngine.FungibleToken;

    const engine = new ZkUsdEngine(PublicKey.fromBase58(engineAddress));
    const token = new FungibleToken(PublicKey.fromBase58(tokenAddress));

    return new ZKUSDClient(txMgr, engine, token);
  }

  /**
   * Creates a new vault
   * @param sender The account creating the vault
   * @param vaultPrivateKey The private key for the new vault
   * @returns Transaction handle for tracking status
   */
  async createVault(
    sender: PublicKey,
    vaultPrivateKey: PrivateKey,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    const zkusdTokenAccount = await this.txMgr.mina.fetchMinaAccount(sender, {
      tokenId: this.token.deriveTokenId(),
      force: true,
    });

    const newAccounts = zkusdTokenAccount ? 1 : 2;

    options = {
      ...options,
      memo: 'Vault creation',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.CREATE_VAULT,
      {
        sender,
        vaultAddress: vaultPrivateKey.toPublicKey().toBase58(),
        newAccounts,
      },
      {
        ...options,
        extraSigners: [...(options?.extraSigners || []), vaultPrivateKey],
      }
    );
  }

  /**
   * Deposits collateral into a vault
   */
  async depositCollateral(
    sender: PublicKey,
    vaultAddress: string,
    amount: UInt64,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    options = {
      ...options,
      memo: 'Collateral deposit',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
      { sender, vaultAddress, amount },
      options
    );
  }

  /**
   * Withdraws collateral from a vault
   */
  async redeemCollateral(
    sender: PublicKey,
    vaultAddress: string,
    amount: UInt64,
    minaPriceInput: MinaPriceInput,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    options = {
      ...options,
      memo: 'Collateral redemption',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.REDEEM_COLLATERAL,
      { sender, vaultAddress, amount, minaPriceInput },
      options
    );
  }

  /**
   * Mints zkUSD tokens
   */
  async mintZkUsd(
    sender: PublicKey,
    vaultAddress: string,
    amount: UInt64,
    minaPriceInput: MinaPriceInput,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    options = {
      ...options,
      memo: 'zkUSD mint',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.MINT_ZKUSD,
      { sender, vaultAddress, amount, minaPriceInput },
      options
    );
  }

  /**
   * Burns zkUSD tokens
   */
  async burnZkUsd(
    sender: PublicKey,
    vaultAddress: string,
    amount: UInt64,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    options = {
      ...options,
      memo: 'zkUSD burn',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.BURN_ZKUSD,
      { sender, vaultAddress, amount },
      options
    );
  }

  /**
   * Liquidates a vault
   */
  async liquidateVault(
    sender: PublicKey,
    vaultAddress: string,
    minaPriceInput: MinaPriceInput,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    options = {
      ...options,
      memo: 'Vault liquidation',
    };

    return this.executeTransaction(
      ZkusdEngineTransactionType.LIQUIDATE,
      { sender, vaultAddress, minaPriceInput },
      options
    );
  }

  /**
   * Fetches the current state of a vault
   */
  async getVaultState(vaultAddress: string): Promise<VaultState> {
    const vaultAccount = await this.txMgr.mina.fetchMinaAccount(
      PublicKey.fromBase58(vaultAddress),
      {
        tokenId: this.engine.deriveTokenId(),
        force: true,
      }
    );

    if (!vaultAccount) {
      throw new Error('Vault not found');
    }

    return Vault.fromAccount(vaultAccount);
  }

  /**
   * Fetches the vault account for a given address
   */
  async fetchVaultAccount(vaultAddress: string) {
    const vaultAccount = await this.txMgr.mina.fetchMinaAccount(
      PublicKey.fromBase58(vaultAddress),
      {
        tokenId: this.engine.deriveTokenId(),
        force: true,
      }
    );

    return vaultAccount;
  }

  public getTokenId(kind: 'token' | 'engine') {
    if (kind === 'token') {
      return this.token.deriveTokenId();
    } else {
      return this.engine.deriveTokenId();
    }
  }

  /**
   * Helper method to execute transactions with consistent error handling and argument preparation
   */
  private async executeTransaction<T extends ZkusdEngineTransactionType>(
    type: T,
    context: TransactionContext,
    options?: TransactionOptions
  ): Promise<TransactionHandle> {
    try {
      const args = this.prepareTransactionArgs(type, context);
      const txArgs: TransactionArgs = {
        transactionType: type,
        args: args as ZkusdEngineTransactionArgs[T],
      } as TransactionArgs;

      return await this.txMgr.engineTx(
        context.sender,
        txArgs,
        this.engine,
        context.minaPriceInput,
        options
      );
    } catch (error) {
      console.error(`Error executing ${type}:`, error);
      throw error;
    }
  }

  /**
   * Prepares transaction arguments based on transaction type
   */
  private prepareTransactionArgs(
    type: ZkusdEngineTransactionType,
    context: TransactionContext
  ): ZkusdEngineTransactionArgs[typeof type] {
    const baseArgs = {
      transactionId: PrivateKey.random().toBase58(),
      vaultAddress: context.vaultAddress,
    };

    switch (type) {
      case ZkusdEngineTransactionType.CREATE_VAULT:
        if (!context.newAccounts) throw new Error('New accounts required');
        return {
          ...baseArgs,
          newAccounts: context.newAccounts,
        };

      case ZkusdEngineTransactionType.DEPOSIT_COLLATERAL:
        if (!context.amount) throw new Error('Amount required');
        return {
          ...baseArgs,
          collateralAmount: context.amount.toString(),
        };

      case ZkusdEngineTransactionType.REDEEM_COLLATERAL:
        if (!context.amount) throw new Error('Amount required');
        if (!context.minaPriceInput) throw new Error('Price input required');
        return {
          ...baseArgs,
          collateralAmount: context.amount.toString(),
          minaPriceProof: context.minaPriceInput.proof.toJSON(),
        };

      case ZkusdEngineTransactionType.MINT_ZKUSD:
        if (!context.amount) throw new Error('Amount required');
        if (!context.minaPriceInput) throw new Error('Price input required');
        return {
          ...baseArgs,
          zkusdAmount: context.amount.toString(),
          minaPriceProof: context.minaPriceInput.proof.toJSON(),
        };

      case ZkusdEngineTransactionType.BURN_ZKUSD:
        if (!context.amount) throw new Error('Amount required');
        return {
          ...baseArgs,
          zkusdAmount: context.amount.toString(),
        };

      case ZkusdEngineTransactionType.LIQUIDATE:
        if (!context.minaPriceInput) throw new Error('Price input required');
        return {
          ...baseArgs,
          minaPriceProof: context.minaPriceInput.proof.toJSON(),
        };

      default:
        throw new Error(`Unsupported transaction type: ${type}`);
    }
  }
}
