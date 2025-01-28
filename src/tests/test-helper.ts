import {
  AccountUpdate,
  Bool,
  Field,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
  VerificationKey,
} from 'o1js';
import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import {
  computeOracleWhitelistHash,
  ContractInstance,
  KeyPair,
  OracleWhitelist,
} from '../types.js';
import { FungibleTokenContract } from '@minatokens/token';
import {
  IMinaNetworkInterface,
  MinaNetworkInterface,
} from '../mina/mina-network-interface.js';
import { NetworkKeyPairs, getNetworkKeys } from '../config/keys.js';
import { DeploymentService } from '../services/deployment.js';
import Client from 'mina-signer';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  MinaPriceInput,
} from '../proofs/oracle-price-aggregation/index.js';
import {
  TransactionHandle,
  TransactionManager,
  TransactionOptions,
} from '../mina/transaction-manager.js';
import { ensureLightnetRunning } from '../utils/lightnet-boot-script.js';

const client = new Client({
  network: 'testnet',
});

export class TestAmounts {
  //ZERO
  static ZERO = UInt64.from(0);

  // Collateral amounts
  static COLLATERAL_900_MINA = UInt64.from(900e9); // 900 Mina
  static COLLATERAL_200_MINA = UInt64.from(200e9); // 200 Mina
  static COLLATERAL_105_MINA = UInt64.from(105e9); // 105 Mina
  static COLLATERAL_100_MINA = UInt64.from(100e9); // 100 Mina
  static COLLATERAL_50_MINA = UInt64.from(50e9); // 50 Mina
  static COLLATERAL_2_MINA = UInt64.from(2e9); // 2 Mina
  static COLLATERAL_1_MINA = UInt64.from(1e9); // 1 Mina

  // zkUSD amounts
  static DEBT_100_ZKUSD = UInt64.from(100e9); // 100 zkUSD
  static DEBT_50_ZKUSD = UInt64.from(50e9); // 50 zkUSD
  static DEBT_40_ZKUSD = UInt64.from(40e9); // 40 zkUSD
  static DEBT_30_ZKUSD = UInt64.from(30e9); // 30 zkUSD
  static DEBT_10_ZKUSD = UInt64.from(10e9); // 10 zkUSD
  static DEBT_5_ZKUSD = UInt64.from(5e9); // 5 zkUSD
  static DEBT_4_ZKUSD = UInt64.from(4e9); // 4 zkUSD
  static DEBT_1_ZKUSD = UInt64.from(1e9); // 1 zkUSD
  static DEBT_50_CENT_ZKUSD = UInt64.from(5e8); // 0.5 zkUSD
  static DEBT_10_CENT_ZKUSD = UInt64.from(1e8); // 0.1 zkUSD

  // Price amounts
  static PRICE_0_USD = UInt64.from(0); // 0 USD
  static PRICE_25_CENT = UInt64.from(0.25e9); // 0.25 USD
  static PRICE_40_CENT = UInt64.from(0.4e9); // 0.40 USD
  static PRICE_48_CENT = UInt64.from(0.48e9); // 0.48 USD
  static PRICE_49_CENT = UInt64.from(0.49e9); // 0.49 USD
  static PRICE_50_CENT = UInt64.from(0.5e9); // 0.50 USD
  static PRICE_51_CENT = UInt64.from(0.51e9); // 0.51 USD
  static PRICE_52_CENT = UInt64.from(0.52e9); // 0.52 USD
  static PRICE_1_USD = UInt64.from(1e9); // 1 USD
  static PRICE_2_USD = UInt64.from(2e9); // 2 USD
  static PRICE_10_USD = UInt64.from(1e10); // 10 USD
}

export interface Agent {
  keys: KeyPair;
  vault?: {
    contract: ZkUsdVault;
    publicKey: PublicKey;
    privateKey: PrivateKey;
  };
}

export class TestHelper {
  protocolResumeCounter = 0;
  protocolStopCounter = 0;
  mina: IMinaNetworkInterface;
  _txMgr: TransactionManager;
  _deploymentService: DeploymentService;

  deployer: KeyPair;
  agents: Record<string, Agent> = {};
  oracles: Record<string, KeyPair> = {};

  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  vaultVerificationKeyHash?: Field;
  oracleAggregationVk: VerificationKey;
  whitelist: OracleWhitelist = new OracleWhitelist({
    addresses: Array(OracleWhitelist.MAX_PARTICIPANTS).fill(PublicKey.empty()),
  });

  whitelistedOracles: Map<string, number> = new Map();

  public get txMgr() {
    return this._txMgr;
  }


  get networkKeys(): NetworkKeyPairs {
    return getNetworkKeys(this.mina.network.chainId);
  }

  createVaultKeyPair(): { publicKey: PublicKey; privateKey: PrivateKey } {
    return PrivateKey.randomKeypair();
  }

  public tx(
    sender: Agent | KeyPair,
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
    },
    call_depth = 1
  ) {
    const keys = 'keys' in sender ? sender.keys : sender;
    return this.txMgr.tx(keys, callback, options, call_depth);
  }

  public async includeTx(
    sender: Agent | KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
    }
  ) {
    const call_depth = 2;
    const h = await this.tx(sender, callback, options, call_depth);
    return await h.awaitIncluded();
  }

  static async initLocalChain(opts?: {
    proofsEnabled?: boolean | undefined;
    enforceTransactionLimits?: boolean | undefined;
  }) {
    const mina = await MinaNetworkInterface.initLocal(opts);
    const deployer = await mina.newAccount();
    return new TestHelper(mina, deployer);
  }

  static async initLightnetChain() {
    await ensureLightnetRunning()
    const mina = await MinaNetworkInterface.initLightnet();
    const deployer = await mina.newAccount();
    return new TestHelper(mina, deployer);
  }

  async deployTokenContracts() {
    this._deploymentService = await DeploymentService.create(
      this.txMgr,
    );
    const deployedContracts = await this._deploymentService.deploy();

    if (this.mina.network.chainId === 'local') {
      this.txMgr.mina.local?.setBlockchainLength(
        UInt32.from(1000)
      );
    }

    this.token = deployedContracts.token;
    this.engine = deployedContracts.engine;
    this.oracleAggregationVk = deployedContracts.oracleAggregationVk;

    let updateOracleWhitelistTx: TransactionHandle | undefined;
    if (this.mina.network.chainId === 'local') {
      for (let i = 0; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
        const oracleName = 'oracle' + (i + 1);
        this.oracles[oracleName] = this.networkKeys.oracles![i];
        this.whitelist.addresses[i] = this.oracles[oracleName].publicKey;
        this.whitelistedOracles.set(oracleName, i);
      }

      updateOracleWhitelistTx = await this.tx(
        this.deployer,
        async () => {
          await this.engine.contract.updateOracleWhitelist(this.whitelist);
        },
        {
          name: `Update Oracle Whitelist`,
          extraSigners: [this.networkKeys.protocolAdmin.privateKey],
        }
      );
    }
    await updateOracleWhitelistTx?.awaitIncluded();
  }

  stringifyAgent(name: string, replacer?: (number | string)[] | null, space?: string | number) {
    let x: Record<string, any> = {};
    x['name'] = name;
    x['keys'] = {
      publicKey: this.agents[name].keys.publicKey.toBase58(),
      privateKey: this.agents[name].keys.privateKey.toBase58(),
    };
    if (this.agents[name].vault) {
      x['vault'] = {
        publicKey: this.agents[name].vault?.publicKey.toBase58(),
        privateKey: this.agents[name].vault?.privateKey.toBase58(),
      }
    }
    return JSON.stringify(x, replacer, space);
  }

  async createAgents(...names: string[]) {
    const ret: Agent[] = [];
    for (const name of names) {
      if (name in this.agents) {
        ret.push(this.agents[name]);
      } else {
        const keys = await this.mina.newAccount();
        await this.mina.fetchMinaAccount(keys.publicKey);
        this.agents[name] = { keys };
        ret.push(this.agents[name]);
      }
    }
    return ret;
  }

  async registerNewAgent(name: string, agent: Agent) {
    this.agents[name] = agent;
    await this.mina.fetchMinaAccount(agent.keys.publicKey, {force:true});
  }

  async createVaults(...names: string[]) {
    const vaultCreationTxs: TransactionHandle[] = [];

    for (const name of names) {
      const agent: Agent | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vaultKeyPair = this.createVaultKeyPair();

      agent.vault = {
        contract: new ZkUsdVault(
          vaultKeyPair.publicKey,
          this.engine.contract.deriveTokenId()
        ),
        publicKey: vaultKeyPair.publicKey,
        privateKey: vaultKeyPair.privateKey,
      };

      console.log(this.stringifyAgent(name));

      const tx = await this.tx(
        agent.keys,
        async () => {
          AccountUpdate.fundNewAccount(agent.keys.publicKey, 2);
          await this.engine.contract.createVault(
            agent.vault!.publicKey
          );
        },
        {
          name: `Create Vault for ${name}`,
          extraSigners: [agent.vault!.privateKey],
        }
      );
      vaultCreationTxs.push(tx);
    }
    return await Promise.all(vaultCreationTxs.map((t) => t.awaitIncluded()));
  }

  async stopTheProtocol() {
    this.protocolStopCounter++;
    await this.includeTx(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(true));
      },
      {
        name: `Stop the protocol #${this.protocolStopCounter}`,
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  async resumeTheProtocol() {
    this.protocolResumeCounter++;
    await this.includeTx(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(false));
      },
      {
        name: `Resume the protocol #${this.protocolResumeCounter}`,
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  async getPriceSubmissions({
    oraclePrice,
    fallbackPrice,
  }: {
    oraclePrice: UInt64;
    fallbackPrice: UInt64;
  }) {
    // const blockHeight = Mina.getNetworkState().blockchainLength;
    const blockHeight = this.mina.getNetworkState().blockchainLength;

    const oraclePriceSubmissions: OraclePriceSubmissions = {
      submissions: [],
    };

    for (let i = 0; i < this.whitelist.addresses.length; i++) {
      const oracleName = 'oracle' + (i + 1);
      const oraclePrivateKey = this.oracles[oracleName].privateKey;
      const oraclePublicKey = oraclePrivateKey.toPublicKey();

      const signature = client.signFields(
        [oraclePrice.toBigInt(), blockHeight.toBigint()],
        oraclePrivateKey.toBase58()
      );

      //build the price submission
      const priceSubmission = new PriceSubmission({
        publicKey: oraclePublicKey,
        signature: Signature.fromBase58(signature.signature),
        price: oraclePrice,
        blockHeight: blockHeight,
        isDummy: Bool(false),
      });

      oraclePriceSubmissions.submissions.push(priceSubmission);
    }

    return oraclePriceSubmissions;
  }

  async getMinaPriceInput(price: UInt64) {
    // const blockHeight = Mina.getNetworkState().blockchainLength;
    const blockHeight = this.mina.getNetworkState().blockchainLength;
    console.log('Building mina price input for block height:', blockHeight.toBigint());

    const oraclePriceSubmissions = await this.getPriceSubmissions({
      oraclePrice: price,
      fallbackPrice: price,
    });

    const oracleWhitelistHash = computeOracleWhitelistHash(this.whitelist);

    const programOutput = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: this.whitelist,
        oraclePriceSubmissions,
      }
    );

    const minaPriceInput = new MinaPriceInput({
      proof: programOutput.proof,
      verificationKey: this.oracleAggregationVk,
    });

    return minaPriceInput;
  }

  private constructor(mina: IMinaNetworkInterface, deployer: KeyPair) {
    this.mina = mina;
    this._txMgr = TransactionManager.new(mina);
    this.deployer = deployer;
  }
}

