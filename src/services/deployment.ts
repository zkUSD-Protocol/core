import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import { FungibleTokenContract } from '@minatokens/token';
import { getNetworkKeys, NetworkKeyPairs } from '../config/keys.js';
import { AccountUpdate, Bool, UInt32, UInt8, VerificationKey } from 'o1js';
import { ContractInstance, KeyPair } from '../types/utility.js';
import { AggregateOraclePrices } from '../proofs/oracle-price-aggregation/prove.js';
import { updateVerificationKeys } from '../utils/update-verification-keys.js';
import { validPriceBlockCount } from '../index.js';
import { TransactionManager } from '../mina/transaction-manager.js';
import { IMinaNetworkInterface } from '../mina/mina-network-interface.js';

/**
 * Represents the set of deployed smart contracts and verification keys.
 */
interface DeployedContracts {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  oracleAggregationVk: VerificationKey;
}

/**
 * Service responsible for deploying and initializing the zkUSD protocol contracts.
 * Handles compilation, deployment, and initialization of the token and engine contracts
 * while managing protocol admin accounts and verification keys.
 */
export class DeploymentService {
  private _txMgr: TransactionManager;
  private _deployer: KeyPair;
  private _mina: IMinaNetworkInterface;
  private _networkKeys: NetworkKeyPairs;
  private _token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  private _engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  private _oracleAggregationVk: VerificationKey;

  private constructor(txMgr: TransactionManager) {
    this._txMgr = txMgr;
    this._mina = txMgr.mina;
    this._networkKeys = getNetworkKeys(this._mina.network.chainId);
  }

  /**
   * Creates a new instance of the DeploymentService.
   * Initializes the deployer account and compiles necessary contracts.
   */
  public static async create(txMgr: TransactionManager) {
    const service = new DeploymentService(txMgr);

    if (service._networkKeys.deployer) {
      service._deployer = service._networkKeys.deployer;
    } else {
      service._deployer = await service._txMgr.mina.newAccount();
    }
    await service.compile();
    return service;
  }

  /**
   * Updates the verification keys for the vault and oracle aggregation contracts.
   * This ensures the protocol uses the latest verification keys for proof validation.
   */
  private updateVerificationKeys() {
    updateVerificationKeys({
      oracleAggregationVk: this._oracleAggregationVk,
    });
  }

  /**
   * Returns the deployer account keypair.
   */
  public get deployer() {
    return this._deployer;
  }

  /**
   * Compiles all necessary contracts and proofs for the protocol.
   * This includes the oracle aggregation proof, vault, engine, and token contracts.
   */
  async compile() {
    console.time('Compiling Contracts');

    const oracleAggCompiled = await AggregateOraclePrices.compile();
    this._oracleAggregationVk = oracleAggCompiled.verificationKey;

    this.updateVerificationKeys();

    const ZkUsdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: this._networkKeys.token.publicKey,
      minaPriceInputZkProgramVkHash: this._oracleAggregationVk.hash,
    });

    await ZkUsdEngine.compile();
    await ZkUsdEngine.FungibleToken.compile();

    this._token = {
      contract: new ZkUsdEngine.FungibleToken(
        this._networkKeys.token.publicKey
      ),
    };

    this._engine = {
      contract: new ZkUsdEngine(this._networkKeys.engine.publicKey),
    };

    console.timeEnd('Compiling Contracts');
  }

  /**
   * Deploys and initializes the entire protocol.
   * This process includes:
   * 1. Creating the protocol admin account if it doesn't exist
   * 2. Deploying the token and engine contracts if they don't exist
   * 3. Initializing the engine contract if not already initialized
   *
   * Each step is executed as a separate transaction and includes appropriate checks
   * to prevent duplicate deployments.
   *
   * @returns Object containing references to deployed contracts and verification keys
   */
  async deploy(): Promise<DeployedContracts> {
    console.log(`Deploying Contracts on ${this._mina.network.chainId}`);

    // Create protocol admin account if it doesn't exist
    const protocolAdminAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.protocolAdmin.publicKey
    );

    if (!protocolAdminAccount) {
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          AccountUpdate.fundNewAccount(this._deployer.publicKey, 1);
          AccountUpdate.createSigned(this._networkKeys.protocolAdmin.publicKey);
        },
        {
          name: 'Creating Protocol Admin account',
          extraSigners: [this._networkKeys.protocolAdmin.privateKey],
        }
      );
      await txHandle.awaitIncluded();
    } else {
      console.log('Protocol Admin account already exists');
    }

    // Deploy token and engine contracts if they don't exist
    const tokenAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.token.publicKey
    );

    if (!tokenAccount) {
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          AccountUpdate.fundNewAccount(this._deployer.publicKey, 3);
          await this._token.contract.deploy({
            symbol: 'zkUSD',
            src: 'https://github.com/zkcloudworker/minatokens-lib/blob/main/packages/token/src/FungibleTokenContract.ts',
          });
          await this._token.contract.initialize(
            this._networkKeys.engine.publicKey,
            UInt8.from(9),
            Bool(false)
          );
          await this._engine.contract.deploy({
            admin: this._networkKeys.protocolAdmin.publicKey,
            validPriceBlockCount: UInt32.from(
              validPriceBlockCount[this._txMgr.mina.network.chainId]
            ),
            emergencyStop: Bool(false),
          });
        },
        {
          extraSigners: [
            this._networkKeys.token.privateKey,
            this._networkKeys.engine.privateKey,
            this._networkKeys.protocolAdmin.privateKey,
          ],
          name: 'Deploying Token and Engine contracts',
        }
      );
      await txHandle.awaitIncluded();
    } else {
      console.log('Token and Engine contracts already deployed');
    }

    // fetch the latest nonce for the accounts
    await this._mina.fetchMinaAccount(this._networkKeys.engine.publicKey);
    await this._mina.fetchMinaAccount(
      this._networkKeys.protocolAdmin.publicKey
    );

    const engineTokenAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.engine.publicKey,
      { tokenId: this._engine.contract.deriveTokenId() }
    );

    if (!engineTokenAccount) {
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          AccountUpdate.fundNewAccount(this._deployer.publicKey, 1);
          await this._engine.contract.initialize();
        },
        {
          extraSigners: [
            this._networkKeys.protocolAdmin.privateKey,
            this._networkKeys.engine.privateKey,
          ],
          name: 'Initializing Engine contract',
        }
      );
      await txHandle.awaitIncluded();
    } else {
      console.log('Engine contract already initialized');
    }

    console.log(`Contracts deployed`);

    return {
      token: this._token,
      engine: this._engine,
      oracleAggregationVk: this._oracleAggregationVk,
    };
  }
}
