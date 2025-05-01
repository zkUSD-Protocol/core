import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import { FungibleTokenContract } from '@minatokens/token';
import { getNetworkKeys, NetworkKeyPairs } from '../config/keys.js';
import {
  AccountUpdate,
  Bool,
  Field,
  MerkleTree,
  Provable,
  PublicKey,
  UInt32,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { ContractInstance, KeyPair } from '../types/utility.js';
import { AggregateOraclePrices } from '../proofs/oracle-price-aggregation/prove.js';
import { TransactionManager } from '../transaction/manager.js';
import { IMinaNetworkInterface } from '../mina/network-interface.js';
import { validPriceBlockCounts } from '../mina/networks.js';
import { updateVerificationKeys } from '../utils/node/update-verification-keys.js';
import { ZkusdGoverningCouncilContract } from '../contracts/zkusd-governing-council.js';
import { GovernanceUpdate } from '../proofs/engine-update/prove.js';
import { CouncilUpdateActions, CouncilUpdateOperation } from '../system/council/update/input.js';
import { ManageCouncil } from '../proofs/council-update/prove.js';
import { CouncilMap } from '../system/council/data/council-map.js';

/**
 * Represents the set of deployed smart contracts and verification keys.
 */
interface DeployedContracts {
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  gov: ZkusdGoverningCouncilContract;
  oracleAggregationVk: VerificationKey;
}
export interface ZkusdCompilationData {
  oracleAggregationVk: VerificationKey;
  governanceUpdateVk: VerificationKey;
  zkusdEngineContractVk: VerificationKey;
  governmentContractVk: VerificationKey;
  tokenContractVk: VerificationKey;
}

/** A proposal is considered valid if the ratio of votes in favor is greater than this value.
    E.g. for 4 council seats a ratio of 2/3 would require 2 votes, 3 votes for 5 seats. */
const CouncilVoteThresholdRatio = 2 / 3;

/**
 * Service responsible for deploying and initializing the zkUSD protocol contracts.
 * Handles compilation, deployment, and initialization of the token and engine contracts
 * while managing protocol admin accounts and verification keys.
 */
export class DeploymentService {
  private _txMgr: TransactionManager<any>;
  private _deployer: KeyPair;
  private _mina: IMinaNetworkInterface;
  private _networkKeys: NetworkKeyPairs;
  private _token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  private _engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  private _gov: ContractInstance<ZkusdGoverningCouncilContract>;
  private _oracleAggregationVk: VerificationKey;
  private _governanceUpdateVk: VerificationKey;
  private _manageCouncilVk: VerificationKey;
  private _compilationData: Partial<ZkusdCompilationData>;

  public get compilationData(): Partial<ZkusdCompilationData> {
    return this._compilationData;
  }

  private constructor(txMgr: TransactionManager<any>) {
    this._txMgr = txMgr;
    this._mina = txMgr.mina;
    this._networkKeys = getNetworkKeys(this._mina.network.chainId);
  }

  /**
   * Creates a new instance of the DeploymentService.
   * Initializes the deployer account and compiles necessary contracts.
   */
  public static async create(txMgr: TransactionManager<any>) {
    const service = new DeploymentService(txMgr);

    if (service._networkKeys.deployer) {
      service._deployer = service._networkKeys.deployer;
    } else {
      service._deployer = await service._txMgr.mina.newAccount();
    }
    service._compilationData = await service.compile();
    return service;
  }

  /**
   * Updates the verification keys for the vault and oracle aggregation contracts.
   * This ensures the protocol uses the latest verification keys for proof validation.
   */
  private updateVerificationKeys() {
    updateVerificationKeys({
      oracleAggregationVk: this._oracleAggregationVk,
      governanceUpdateVk: this._governanceUpdateVk,
      manageCouncilVk: this._manageCouncilVk,
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
  async compile(): Promise<Partial<ZkusdCompilationData>> {
    console.log('Compiling Contracts - start');
    console.time('Compiling Contracts');

    const oracleAggCompiled = await AggregateOraclePrices.compile();
    this._oracleAggregationVk = oracleAggCompiled.verificationKey;

    const governanceUpdateCompiled = await GovernanceUpdate.compile();
    this._governanceUpdateVk = governanceUpdateCompiled.verificationKey;

    const manageCouncilCompiled = await ManageCouncil.compile();
    this._manageCouncilVk = manageCouncilCompiled.verificationKey;
    this.updateVerificationKeys();

    const ZkUsdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: this._networkKeys.token.publicKey,
      minaPriceInputZkProgramVkHash: this._oracleAggregationVk.hash,
      zkUsdGovernmentAddress: this._networkKeys.government.publicKey,
      GovernmentClass: ZkusdGoverningCouncilContract,
    });
    let engineCompilationResults;
    let tokenCompilationResults;
    let governmenttokenCompilationResults;

    if (this._mina.proofsEnabled) {
      engineCompilationResults = await ZkUsdEngine.compile();
      tokenCompilationResults = await ZkUsdEngine.FungibleToken.compile();
      governmenttokenCompilationResults =
        await ZkusdGoverningCouncilContract.compile();
    }

    this._token = {
      contract: new ZkUsdEngine.FungibleToken(
        this._networkKeys.token.publicKey
      ),
    };

    this._engine = {
      contract: new ZkUsdEngine(this._networkKeys.engine.publicKey),
    };

    this._gov = {
      contract: new ZkusdGoverningCouncilContract(
        this._networkKeys.government.publicKey
      ),
    };

    console.timeEnd('Compiling Contracts');
    return {
      oracleAggregationVk: this._oracleAggregationVk,
      governanceUpdateVk: this._governanceUpdateVk,
      zkusdEngineContractVk: engineCompilationResults?.verificationKey,
      governmentContractVk: tokenCompilationResults?.verificationKey,
      tokenContractVk: governmenttokenCompilationResults?.verificationKey,
    };
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
  async deploy(force: boolean = false): Promise<DeployedContracts> {
    console.log(`Deploying Contracts on ${this._mina.network.chainId}`);

    // Create protocol admin account if it doesn't exist
    const protocolAdminAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.protocolAdmin.publicKey,
      { force: true }
    );

    if (!protocolAdminAccount) {
      console.log('Protocol Admin account doesnt exist - creating....');
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          AccountUpdate.fundNewAccount(this._deployer.publicKey, 1);
          AccountUpdate.createSigned(this._networkKeys.protocolAdmin.publicKey);
        },
        {
          name: 'Creating Protocol Admin account',
          extraSigners: [this._networkKeys.protocolAdmin.privateKey],
          executor: 'local',
        }
      );
      await txHandle.awaitIncluded();
    } else {
      console.log('Protocol Admin account already exists');
    }

    // Deploy token and engine contracts if they don't exist
    const tokenAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.token.publicKey,
      { force: true }
    );

    const govAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.government.publicKey,
      { force: true }
    );
    this._networkKeys.government.publicKey, { force: true };

    if (!tokenAccount || force) {
      if (!force) console.log('Contracts dont exist - deploying....');
      else console.log('Forcing contracts deployment....');
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          if (!tokenAccount)
            AccountUpdate.fundNewAccount(this._deployer.publicKey, 3);
          await this._token.contract.deploy({
            symbol: 'zkUSD',
            src: 'https://github.com/zkcloudworker/minatokens-lib/blob/main/packages/token/src/FungibleTokenContract.ts',
            allowUpdates: true,
          });
          await this._token.contract.initialize(
            this._networkKeys.engine.publicKey,
            UInt8.from(9),
            Bool(false)
          );
          await this._engine.contract.deploy({
            admin: this._networkKeys.protocolAdmin.publicKey,
            validPriceBlockCount: UInt8.from(
              validPriceBlockCounts[this._txMgr.mina.network.chainId]
            ),
            emergencyStop: Bool(false),
            collateralRatio: UInt8.from(150),
            liquidationBonusRatio: UInt8.from(110),
            vaultDebtCeiling: UInt64.from(200_000n * BigInt(1e9)), // 200k USD
            vaultCreationDisabled: Bool(false),
          });
        },
        {
          extraSigners: [
            this._networkKeys.token.privateKey,
            this._networkKeys.engine.privateKey,
            this._networkKeys.protocolAdmin.privateKey,
          ],
          name: 'Deploying Token and Engine contracts',
          executor: 'local',
        }
      );
      await txHandle.awaitIncluded();
    } else {
      console.log('Token and Engine contracts already deployed');
    }

    if (!govAccount || force) {
      const councilKeys = this._networkKeys.council?.map(
        (key) => key.publicKey
      );
      if (!councilKeys || councilKeys.length == 0) {
        throw new Error('Council keys not found in the network keys');
      }

      let councilManagementActions = new CouncilUpdateActions({
        actions: [],
      });

      for (let i = 0; i < CouncilUpdateActions.MaxLength; i++) {
        if (i < councilKeys.length) {
          councilManagementActions.actions.push(
            new CouncilUpdateOperation({
              councilKey: councilKeys[i],
              councilSeatPosition: Field.from(2n ** BigInt(i)),
              shouldAdd: Bool(true),
              isDummy: Bool(false),
            })
          );
        } else {
          councilManagementActions.actions.push(
            new CouncilUpdateOperation({
              councilKey: PublicKey.empty(),
              councilSeatPosition: Field.from(0),
              shouldAdd: Bool(false),
              isDummy: Bool(true),
            })
          );
        }
      }

      const threshold = Math.floor(
        CouncilVoteThresholdRatio * councilKeys?.length
      );

      if (threshold > CouncilMap.SEAT_LIMIT) {
        throw new Error(
          `Council size exceeds the maximum size of ${CouncilMap.SEAT_LIMIT}`
        );
      }

      if (!force) console.log('Gov contracts dont exist deploying');
      else console.log('Forcing contracts deployment....');

      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          AccountUpdate.fundNewAccount(this._deployer.publicKey, 1);
          await this._gov.contract.deploy();
          await this._gov.contract.initialize(
            councilManagementActions,
            UInt8.from(threshold)
          );
        },
        {
          extraSigners: [this._networkKeys.government.privateKey],
          name: 'Deploying & initializing Gov contracts',
          executor: 'local',
        }
      );
      await txHandle.awaitIncluded();

      //Lets verify that the actions create the same root as on chain
      const onChainRoot = await this._gov.contract.councilMerkleMapRoot.fetch();

      console.log('On chain root', onChainRoot?.toString());

      const merkleMap = CouncilMap.buildFromOperations(
        councilManagementActions.actions
      );

      console.log('Merkle map', merkleMap.root.toString());
    } else {
      console.log('Gov contracts already deployed');
    }

    // fetch the latest nonce for the accounts
    await this._mina.fetchMinaAccount(this._networkKeys.engine.publicKey);
    await this._mina.fetchMinaAccount(
      this._networkKeys.protocolAdmin.publicKey
    );

    const engineTokenAccount = await this._mina.fetchMinaAccount(
      this._networkKeys.engine.publicKey,
      { tokenId: this._engine.contract.deriveTokenId(), force: true }
    );

    if (!engineTokenAccount || force) {
      console.log('Initializing Engine contract....');
      const txHandle = await this._txMgr.tx(
        this._deployer,
        async () => {
          if (!engineTokenAccount)
            AccountUpdate.fundNewAccount(this._deployer.publicKey, 1);
          await this._engine.contract.initialize();
        },
        {
          extraSigners: [
            this._networkKeys.protocolAdmin.privateKey,
            this._networkKeys.engine.privateKey,
          ],
          name: 'Initializing Engine contract',
          executor: 'local',
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
      gov: this._gov.contract,
    };
  }
}
