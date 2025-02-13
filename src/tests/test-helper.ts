import {
  AccountUpdate,
  Bool,
  fetchLastBlock,
  Field,
  JsonProof,
  Poseidon,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
  VerificationKey,
} from 'o1js';
import fs from 'fs';

import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';

import { FungibleTokenContract } from '@minatokens/token';
import { AgentKeys, NetworkKeyPairs, getNetworkKeys } from '../config/keys.js';
import Client from 'mina-signer';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  MinaPriceInput,
  AggregateOraclePricesProof,
} from '../proofs/oracle-price-aggregation/index.js';
import {
  ContractInstance,
  KeyPair,
  singleDefault,
  WithDefault,
} from '../types/utility.js';
import crypto from 'crypto';
import { validPriceBlockCount } from '../mina/networks.js';
import { Mutex } from '../utils/mutex.js';
import { Account } from '../mina/utils.js';
import { IMinaNetworkInterface, MinaNetworkInterface } from '../mina/network-interface.js';
import { TransactionHandle, TransactionManager, TransactionOptions } from '../transaction/manager.js';
import { OracleWhitelist } from '../system/oracle.js';
import { ITransactionExecutor, TransactionArgs } from '../transaction/executor.js';
import { VaultTransactionType } from '../system/transaction.js';
import { ProtocolData } from '../system/engine.js';
import { Vault, VaultState } from '../system/vault.js';
import { DeploymentService } from '../deployment/deployment.js';
import { LocalTransactionExecutor } from '../transaction/local-executor.js';

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
  static COLLATERAL_99_MINA = UInt64.from(99e9); // 99 Mina
  static COLLATERAL_80_MINA = UInt64.from(80e9); // 80 Mina
  static COLLATERAL_50_MINA = UInt64.from(50e9); // 50 Mina
  static COLLATERAL_20_MINA = UInt64.from(20e9); // 20 Mina
  static COLLATERAL_2_MINA = UInt64.from(2e9); // 2 Mina
  static COLLATERAL_1_MINA = UInt64.from(1e9); // 1 Mina

  // zkUSD amounts
  static DEBT_100_ZKUSD = UInt64.from(100e9); // 100 zkUSD
  static DEBT_50_ZKUSD = UInt64.from(50e9); // 50 zkUSD
  static DEBT_40_ZKUSD = UInt64.from(40e9); // 40 zkUSD
  static DEBT_30_ZKUSD = UInt64.from(30e9); // 30 zkUSD
  static DEBT_20_ZKUSD = UInt64.from(20e9); // 20 zkUSD
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

export class TestHelper<E extends string> {
  protocolResumeCounter = 0;
  protocolStopCounter = 0;
  mina: IMinaNetworkInterface;
  _txMgr: TransactionManager<E | 'local'>; // must have a local executor
  _deploymentService: DeploymentService;

  private _priceInputMgr: PriceInputManager;
  public get priceInputMgr(): PriceInputManager {
    if (!this._priceInputMgr) {
      throw new Error(
        'PriceInputManager not initialized. Deploy contracts first.'
      );
    }
    return this._priceInputMgr;
  }

  deployer: KeyPair;
  agents: Record<string, AgentKeys> = {};
  oracles: Record<string, KeyPair> = {};

  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;
  vaultVerificationKeyHash?: Field;
  oracleAggregationVk: VerificationKey;
  whitelist: OracleWhitelist = new OracleWhitelist({
    addresses: Array(OracleWhitelist.MAX_PARTICIPANTS).fill(PublicKey.empty()),
  });

  whitelistedOracles: Map<string, number> = new Map();

  static test: string | undefined = undefined;

  public get txMgr() {
    return this._txMgr;
  }

  get networkKeys(): NetworkKeyPairs {
    return getNetworkKeys(this.mina.network.chainId);
  }

  privateKeyFromSeed(seed: string): PrivateKey {
    const encoder = new TextEncoder();
    const data = encoder.encode(seed);
    const hashBuffer = crypto.createHash('sha256').update(data).digest();
    const hashBigInt = BigInt('0x' + hashBuffer.toString('hex'));
    return PrivateKey.fromBigInt(hashBigInt);
  }

  createVaultKeyPair(seed: string): {
    publicKey: PublicKey;
    privateKey: PrivateKey;
  } {
    const privateKey = this.privateKeyFromSeed(seed);
    return {
      publicKey: privateKey.toPublicKey(),
      privateKey: privateKey,
    };
  }

  public tx(
    sender: AgentKeys | KeyPair,
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
      executor?: E | 'local';
    }
  ) {
    const keys = 'keys' in sender ? sender.keys : sender;
    return this.txMgr.tx(keys, callback, options);
  }

  public async includeTx(
    sender: AgentKeys | KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
      startingFee?: UInt64;
      executor?: E | 'local';
    }
  ): Promise<void> {
    let startingFee: UInt64 | undefined;

    if (this._txMgr.mina.network.chainId === 'local') {
      startingFee = new UInt64(0);
    }

    const h = await this.tx(sender, callback, {
      ...options,
      startingFee: options?.startingFee ?? startingFee,
    });
    await h.awaitIncluded();
  }

  // Single implementation
  static async initLocalChain<E extends string = 'local'>(opts?: {
    txExecutors?: WithDefault<E | 'local', ITransactionExecutor>;
    proofsEnabled?: boolean;
    enforceTransactionLimits?: boolean;
  }): Promise<TestHelper<E>> {
    const mina = await MinaNetworkInterface.initLocal(opts);
    const deployer = await mina.newAccount();

    // If opts.txExecutors is provided, use it; otherwise, use the default.
    // When not provided, we know that E should be "local".
    const executor: WithDefault<E | 'local', ITransactionExecutor> =
      opts?.txExecutors ??
      (singleDefault(
        'local',
        new LocalTransactionExecutor()
      ) as unknown as WithDefault<E | 'local', ITransactionExecutor>);

    return new TestHelper(mina, executor, deployer);
  }

  static async initLightnetChain<E extends string = 'local'>(
    opts?: {
      txExecutorInitializers?: WithDefault<
        E | 'local',
        (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
      >;
      ensureLightnet?: boolean
    },
  ): Promise<TestHelper<E>> {
    // Ensure the lightnet environment is running.

    // if undefined we DO
    if (opts?.ensureLightnet){
      throw new Error("Lightnet ensuring not available. Start it manully.");
      // await ensureLightnetRunning();
    }

    // Initialize the network interface.
    const mina = await MinaNetworkInterface.initLightnet();
    const deployer = await mina.newAccount();

    // If no initializers are provided, default to one keyed by "local".
    const initializers: WithDefault<
      E | 'local',
      (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
    > =
      opts?.txExecutorInitializers ??
      (singleDefault(
        'local',
        async () => new LocalTransactionExecutor()
      ) as unknown as WithDefault<
        E | 'local',
        (mina: IMinaNetworkInterface) => Promise<ITransactionExecutor>
      >);

    // Transform the record:
    // 1. For each key (except the "default" property) call the initializer with the chain id.
    // 2. Reassemble a WithDefault record of executors.
    const executorKeys = (
      Object.keys(initializers) as Array<keyof typeof initializers>
    ).filter((k) => k !== 'default') as E[];
    const executors: Partial<Record<E, ITransactionExecutor>> = {};
    for (const key of executorKeys) {
      executors[key] = await initializers[key](mina);
    }
    // Set the default property on the executors record.
    (executors as WithDefault<E | 'local', ITransactionExecutor>).default =
      initializers.default;

    const txExecutors = executors as WithDefault<
      E | 'local',
      ITransactionExecutor
    >;

    // Pass the transformed WithDefault record of executors to the TestHelper constructor.
    return new TestHelper(mina, txExecutors, deployer);
  }

  async setupLightnet() {
    if (this.mina.network.chainId !== 'lightnet') {
      throw new Error('Not on lightnet');
    }

    //First lets deploy the contracts
    await this.deployTokenContracts();

    //Now we need to fund the agents

    //Lets check to see whether the accounts already exist and are funded
    let accountsNotCreated = false;
    let accountUnderFunded = false;

    console.log('Checking agent accounts...');

    for (const agent of Object.keys(this.agents)) {
      const account = await this._txMgr.mina.fetchMinaAccount(
        this.agents[agent].keys.publicKey,
        {
          force: true,
        }
      );
      if (!!account) {
        if (
          account.balance.toBigInt() <=
          TestAmounts.COLLATERAL_100_MINA.toBigInt()
        ) {
          console.log(
            `Account for ${agent} is underfunded, topping up agents now...`
          );
          accountUnderFunded = true;
          break;
        }
      } else {
        console.log(
          'Agent accounts not created yet, creating and funding them now...'
        );
        accountsNotCreated = true;
        break;
      }
    }

    if (accountsNotCreated || accountUnderFunded) {
      const funder = await this.mina.newAccount();

      //Start everyone out with 200 Mina
      await this.includeTx(
        funder,
        async () => {
          let au;
          if (accountsNotCreated) {
            console.log('Funding new accounts');
            au = AccountUpdate.fundNewAccount(
              funder.publicKey,
              Object.keys(this.agents).length
            );
          } else {
            console.log('Funding existing accounts');
            au = AccountUpdate.createSigned(funder.publicKey);
          }
          for (const agent of Object.keys(this.agents)) {
            au.send({
              to: this.agents[agent].keys.publicKey,
              amount: TestAmounts.COLLATERAL_200_MINA,
            });
          }
        },
        {
          executor: 'local', // use local executor for tx not supported by workers
          name: 'Fund Lightnet Agents',
        }
      );
    } else {
      console.log('Agent accounts found and sufficently funded');
    }

    console.log('Creating agent vaults...');
    await this.createVaults(...Object.keys(this.agents));

    console.log('Depositing collateral for agents...');
    await this.depositAgentCollateral(
      TestAmounts.COLLATERAL_100_MINA,
      ...Object.keys(this.agents)
    );

    console.log('Minting zkUSD for agents...');

    await this.mintAgentZkUsd(
      TestAmounts.DEBT_20_ZKUSD,
      ...Object.keys(this.agents)
    );

    await this.printAgentState();

    console.log('Lightnet Setup Complete');
  }

  async deployTokenContracts() {
    this._deploymentService = await DeploymentService.create(this.txMgr);
    const deployedContracts = await this._deploymentService.deploy();

    if (this.mina.network.chainId === 'local') {
      this.txMgr.mina.local?.setBlockchainLength(UInt32.from(1000));
    }

    this.token = deployedContracts.token;
    this.engine = deployedContracts.engine;
    this.oracleAggregationVk = deployedContracts.oracleAggregationVk;

    if (['local', 'lightnet'].includes(this.mina.network.chainId)) {
      for (let i = 0; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
        const oracleName = 'oracle' + (i + 1);
        this.oracles[oracleName] = this.networkKeys.oracles![i];
        this.whitelist.addresses[i] = this.oracles[oracleName].publicKey;
        this.whitelistedOracles.set(oracleName, i);
      }

      const oracleWhitelistHash = OracleWhitelist.hash(this.whitelist);

      const engineOracleWhitelistHash =
        await this.engine.contract.oracleWhitelistHash.fetch();

      // initialize the price input manager
      this._priceInputMgr = new PriceInputManager(
        this._txMgr.o1jsMutex,
        this.mina,
        this.oracleAggregationVk,
        this.whitelist,
        this.oracles,
        'price-inputs.json'
      );
      await this._priceInputMgr.init();

      if (
        !!engineOracleWhitelistHash &&
        engineOracleWhitelistHash.toBigInt() == oracleWhitelistHash.toBigInt()
      ) {
        console.log('Oracle whitelist already set');
        return;
      } else {
        console.log('Updating oracle whitelist');
      }

      await this.includeTx(
        this.deployer,
        async () => {
          await this.engine.contract.updateOracleWhitelist(this.whitelist);
        },
        {
          name: `Update Oracle Whitelist`,
          extraSigners: [this.networkKeys.protocolAdmin.privateKey],
          executor: 'local', // use local executor when tx is not supported by workers
        }
      );
    } else {
      throw new Error(`Only use it on lightnet and local  found: ${this.mina.network.chainId}`);
    }
  }

  stringifyAgent(
    name: string,
    replacer?: (number | string)[] | null,
    space?: string | number
  ) {
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
      };
    }
    return JSON.stringify(x, replacer, space);
  }

  async createLocalAgents(...names: string[]) {
    const ret: AgentKeys[] = [];
    for (const name of names) {
      if (name in this.agents) {
        ret.push(this.agents[name]);
      } else {
        const keys = await this.mina.newAccount();
        await this.mina.fetchMinaAccount(keys.publicKey);
        const vaultKeyPair = this.createVaultKeyPair(name);
        this.agents[name] = { keys, vault: vaultKeyPair };
        ret.push(this.agents[name]);
      }
    }
    return ret;
  }

  async registerNewAgent(name: string, agent: AgentKeys) {
    this.agents[name] = agent;
    await this.mina.fetchMinaAccount(agent.keys.publicKey, { force: true });
  }

  async engineTx(
    sender: KeyPair,
    args: TransactionArgs,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
    }
  ) {
    let minaPriceInput: MinaPriceInput | undefined;
    if ('minaPriceProof' in args.args) {
      minaPriceInput = await this.priceInputMgr.getMinaPriceInputForProof(
        args.args.minaPriceProof
      );
    } else {
      minaPriceInput = undefined;
    }

    let refreshAccounts: Account[] = [
      { publicKey: this.engine.contract.address }, // engine
      // sender
      { publicKey: sender.publicKey },
      // vault
      { publicKey: PublicKey.fromBase58(args.args.vaultAddress)
        , tokenId: this.engine.contract.deriveTokenId()
      },
      // sender zkusd
      { publicKey: sender.publicKey
      , tokenId: this.engine.contract.deriveTokenId() },
    ]

    return this.txMgr.engineTx(
      sender,
      args,
      this.engine.contract,
      minaPriceInput,
      {...options, refreshAccounts} 
    );
  }

  async includeEngineTx(
    sender: KeyPair,
    args: TransactionArgs,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
    }
  ) {
    const h = await this.engineTx(sender, args, options);
    return await h.awaitIncluded();
  }

  async depositAgentCollateral(amount: UInt64, ...names: string[]) {
    const agentDepositTxs: TransactionHandle[] = [];

    for (const name of names) {
      const agent: AgentKeys | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vault = await this.retrieveAgentVaultState(name);

      if (vault.collateralAmount.toBigInt() >= amount.toBigInt()) {
        continue;
      }

      const tx = await this.engineTx(agent.keys, {
        transactionType: VaultTransactionType.DEPOSIT_COLLATERAL,
        args: {
          transactionId: `Depositing ${amount} collateral for ${name}`,
          vaultAddress: agent.vault!.publicKey.toBase58(),
          collateralAmount: amount.toString(),
        },
      });
      agentDepositTxs.push(tx);
    }

    return await Promise.all(agentDepositTxs.map((t) => t.awaitIncluded()));
  }

  async mintAgentZkUsd(amount: UInt64, ...names: string[]) {
    const agentMintTxs: TransactionHandle[] = [];

    let oneUsd = UInt64.from(1e9);

    for (const name of names) {
      const agent: AgentKeys | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vault = await this.retrieveAgentVaultState(name);

      if (vault.debtAmount.toBigInt() >= amount.toBigInt()) {
        continue;
      }

      const tx = await this.engineTx(
        agent.keys,
        {
          transactionType: VaultTransactionType.MINT_ZKUSD,
          args: {
            transactionId: `Minting ${amount} zkUSD for ${name}`,
            vaultAddress: agent.vault!.publicKey.toBase58(),
            zkusdAmount: amount.toString(),
            minaPriceProof: (
              await this.priceInputMgr.requestProof(
                oneUsd,
                this.minimalPriceValidity
              )
            ).proof,
          },
        },
        {
          printTx: true,
        }
      );

      agentMintTxs.push(tx);
    }

    return await Promise.all(agentMintTxs.map((t) => t.awaitIncluded()));
  }

  async createVaults(...names: string[]) {
    const vaultCreationTxs: TransactionHandle[] = [];

    for (const name of names) {
      const agent: AgentKeys | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vaultKeyPair = agent.vault;

      const vaultAccount = await this.mina.fetchMinaAccount(
        vaultKeyPair.publicKey,
        {
          tokenId: this.engine.contract.deriveTokenId(),
          force: true,
        }
      );

      if (vaultAccount) {
        continue;
      }

      console.log(`Creating vault for ${name}`);

      // change to using engine tx
      const tx = await this.engineTx(
        agent.keys,
        {
          transactionType: VaultTransactionType.CREATE_VAULT,
          args: {
            transactionId: `Create Vault for ${name}`,
            vaultAddress: vaultKeyPair.publicKey.toBase58(),
            newAccounts: 2,
          },
        },
        {
          extraSigners: [agent.vault!.privateKey],
        }
      );
      vaultCreationTxs.push(tx);
    }
    return await Promise.all(vaultCreationTxs.map((t) => t.awaitIncluded()));
  }

  async stopTheProtocol() {
    const packedProtocolData =
      await this.engine.contract.protocolDataPacked.fetch();

    if (!packedProtocolData) {
      throw new Error('Protocol data not found');
    }

    //Check to see if the protocol is already stopped
    const protocolData = ProtocolData.unpack(packedProtocolData);
    if (protocolData.emergencyStop.toBoolean()) {
      console.log('Protocol is already stopped');
      return;
    }

    this.protocolStopCounter++;
    await this.includeTx(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(true));
      },
      {
        name: `Stop the protocol #${this.protocolStopCounter}`,
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
        executor: 'local', // use local executor for tx not supported by workers
      }
    );
  }

  async resumeTheProtocol() {
    const packedProtocolData =
      await this.engine.contract.protocolDataPacked.fetch();

    if (!packedProtocolData) {
      throw new Error('Protocol data not found');
    }

    const protocolData = ProtocolData.unpack(packedProtocolData);
    if (!protocolData.emergencyStop.toBoolean()) {
      console.log('Protocol is already running');
      return;
    }

    this.protocolResumeCounter++;
    await this.includeTx(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(false));
      },
      {
        executor: 'local', // use local executor for tx not supported by workers
        name: `Resume the protocol #${this.protocolResumeCounter}`,
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  get minimalPriceValidity() {
    return this.mina.network.chainId == 'local' ? 1n : 10n;
  }

  async getMinaPriceInput(
    price: UInt64,
    opts?: { minimalValidity?: bigint; blockHeight?: UInt32 }
  ) {
    const minimalValidity = opts?.minimalValidity ?? this.minimalPriceValidity;
    return this.priceInputMgr.getMinaPriceInput(
      price,
      minimalValidity,
      opts?.blockHeight
    );
  }
  public async retrieveVaultState(
    vault: PublicKey
  ): Promise<VaultState | undefined> {
    const vaultAccount = await this.mina.fetchMinaAccount(vault, {
      tokenId: this.engine.contract.deriveTokenId(),
      force: true,
    });

    if (!vaultAccount) {
      return undefined;
    }

    return Vault.fromAccount(vaultAccount);
  }

  public async retrieveAgentVaultState(agentName: string): Promise<VaultState> {
    if (!this.agents[agentName]) {
      throw new Error(`Agent ${agentName} not found`);
    }
    const vault = this.agents[agentName].vault!.publicKey;

    const vaultState = await this.retrieveVaultState(vault);

    if (!vaultState) {
      throw new Error(`Vault for ${agentName} does not exist`);
    }
    return vaultState as VaultState;
  }

  async printAgentState() {
    console.log('\n=== Agent States ===\n');

    for (const name of Object.keys(this.agents)) {
      const agent = this.agents[name];
      const vault = await this.retrieveAgentVaultState(name);

      const agentAccount = await this.mina.fetchMinaAccount(
        agent.keys.publicKey,
        { force: true }
      );

      if (!agentAccount) {
        console.log(`Agent ${name} not found`);
        continue;
      }

      const agentZkUsdAccount = await this.mina.fetchMinaAccount(
        agent.keys.publicKey,
        {
          tokenId: this.token.contract.deriveTokenId(),
          force: true,
        }
      );

      if (!agentZkUsdAccount) {
        console.log(`Agent ${name} zkUSD account not found`);
        continue;
      }

      console.log(`📝 Agent: ${name.toUpperCase()}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🔑 Agent Public Key: ${agent.keys.publicKey.toBase58()}`);
      console.log(`💰 Agent Balances:`);
      console.log(
        `   • MINA: ${agentAccount?.balance.toBigInt() / BigInt(1e9)} MINA`
      );
      console.log(
        `   • zkUSD: ${
          agentZkUsdAccount?.balance.toBigInt() / BigInt(1e9)
        } zkUSD`
      );

      console.log(`\n🏦 Vault Details:`);
      console.log(`   • Address: ${agent.vault!.publicKey.toBase58()}`);
      console.log(
        `   • Collateral: ${
          vault.collateralAmount.toBigInt() / BigInt(1e9)
        } MINA`
      );
      console.log(
        `   • Debt: ${vault.debtAmount.toBigInt() / BigInt(1e9)} zkUSD`
      );

      console.log('\n'); // Add extra line between agents
    }
  }
  private constructor(
    mina: IMinaNetworkInterface,
    txExecutors: WithDefault<E | 'local', ITransactionExecutor>,
    deployer: KeyPair
  ) {
    this.mina = mina;
    this._txMgr = TransactionManager.new(mina, txExecutors);
    this.deployer = deployer;

    //Set up the agents for lightnet
    if (this.mina.network.chainId === 'lightnet') {
      const agents = this.networkKeys.agents;

      if (!agents) {
        throw new Error('No agents found in network keys');
      }

      for (const agent of Object.keys(agents)) {
        this.agents[agent] = agents[agent];
      }
    }
  }
}

type Proof = {
  proof: JsonProof;
  hash: string;
  blockHeight: string;
};

class PriceInputManager {
  private o1jsMutex: Mutex; // to use or not to use
  private mina: IMinaNetworkInterface;
  private oracleAggregationVk: VerificationKey;
  private whitelist: OracleWhitelist;
  private oracles: Record<string, KeyPair>;

  private proofPath: string;
  // proofs by proof hash.
  private proofs: Map<string, Proof[]> = new Map();

  constructor(
    o1jsMutex: Mutex,
    mina: IMinaNetworkInterface,
    oracleAggregationVk: VerificationKey,
    whitelist: OracleWhitelist,
    oracles: Record<string, KeyPair>,
    proofPath: string
  ) {
    this.o1jsMutex = o1jsMutex;
    this.mina = mina;
    this.oracleAggregationVk = oracleAggregationVk;
    this.whitelist = whitelist;
    this.oracles = oracles;
    this.proofPath = proofPath;
  }
  async init(): Promise<void> {
    try {
      await this.loadProofs();
    } catch (error: any) {
      // Check if the error is due to the file not existing
      if (error.code === 'ENOENT') {
        console.warn(
          `Proof file not found at ${this.proofPath}. Initializing a new file.`
        );
        this.proofs = new Map();
        await this.saveProofs();
      } else {
        console.error('Failed to load proofs:', error);
        throw new Error('Error loading proofs from file.');
      }
    }
  }

  private async loadProofs(): Promise<void> {
    try {
      const proofData = await fs.promises.readFile(this.proofPath, 'utf-8');
      const proofEntries = JSON.parse(proofData);
      this.proofs = new Map(proofEntries);
    } catch (error) {
      // Rethrow the error so the init() method can handle it appropriately.
      throw error;
    }
  }

  private async saveProofs(): Promise<void> {
    try {
      const proofData = JSON.stringify(Array.from(this.proofs.entries()));
      await fs.promises.writeFile(this.proofPath, proofData);
    } catch (error) {
      console.error('Failed to save proofs:', error);
      throw new Error('Error saving proofs to file.');
    }
  }

  private get priceValidity(): number {
    return validPriceBlockCount[this.mina.network.chainId];
  }

  private async currentBlockHeight(): Promise<UInt32> {
    if (this.mina.network.chainId === 'local') {
      return this.mina.getNetworkState().blockchainLength;
    } else {
      return (await fetchLastBlock()).blockchainLength;
    }
  }

  async addNewProof(price: UInt64, blockHeight?: UInt32): Promise<Proof> {
    const blockH = blockHeight ?? (await this.currentBlockHeight());

    console.log(
      'Building mina price input for block height:',
      blockH.toBigint()
    );

    const oraclePriceSubmissions = await this.getPriceSubmissions({
      oraclePrice: price,
      blockHeight: blockH,
    });

    const oracleWhitelistHash = OracleWhitelist.hash(this.whitelist);

    const { proof, proofHash } = await this.o1jsMutex.runExclusive(async () => {
      const programOutput = await AggregateOraclePrices.compute(
        {
          currentBlockHeight: blockH,
          oracleWhitelistHash,
        },
        {
          oracleWhitelist: this.whitelist,
          oraclePriceSubmissions,
        }
      );
      const proof = programOutput.proof;

      const proofHash = Poseidon.hash([
        this.oracleAggregationVk.hash,
        OracleWhitelist.hash(this.whitelist),
        ...price.toFields(),
      ]);
      return { proof, proofHash };
    });

    const storedProof: Proof = {
      proof: proof.toJSON(),
      hash: proofHash.toString(),
      blockHeight: blockH.toString(),
    };

    if (this.proofs.has(proofHash.toString())) {
      this.proofs.get(proofHash.toString())?.push(storedProof);
    } else {
      this.proofs.set(proofHash.toString(), [storedProof]);
    }

    await this.saveProofs();
    return storedProof;
  }
  async getMinaPriceInputForProof(
    jsonproof: JsonProof
  ): Promise<MinaPriceInput> {
    const proof = await AggregateOraclePricesProof.fromJSON(jsonproof);

    return new MinaPriceInput({
      proof,
      verificationKey: this.oracleAggregationVk,
    });
  }

  async getMinaPriceInput(
    price: UInt64,
    minimalValidity = 1n,
    blockHeight?: UInt32
  ): Promise<MinaPriceInput> {
    const blockH = blockHeight ?? (await this.currentBlockHeight());
    const jsonProof = await this.requestProof(price, minimalValidity, blockH);
    return this.getMinaPriceInputForProof(jsonProof.proof);
  }

  computeHash(price: UInt64) {
    return Poseidon.hash([
      this.oracleAggregationVk.hash,
      OracleWhitelist.hash(this.whitelist),
      ...price.toFields(),
    ]);
  }

  async requestProof(
    price: UInt64,
    minimalValidity: bigint = 1n,
    blockHeight?: UInt32
  ): Promise<Proof> {
    const blockH = blockHeight ?? (await this.currentBlockHeight());
    const proofHash = this.computeHash(price);
    const proofs = this.proofs.get(proofHash.toString());

    if (!proofs) {
      return await this.addNewProof(price, blockH);
    } else {
      // Try to find a valid proof - the first one that is not expired yet
      for (const proof of proofs) {
        if (
          BigInt(proof.blockHeight) + BigInt(this.priceValidity) >=
            blockH.toBigint() + minimalValidity &&
          // and already valid!
          blockH.toBigint() >= BigInt(proof.blockHeight)
        ) {
          return proof;
        }
      }
    }

    const storedProof = await this.addNewProof(price, blockH);
    return storedProof;
  }

  async getPriceSubmissions({
    oraclePrice,
    blockHeight,
  }: {
    oraclePrice: UInt64;
    blockHeight: UInt32;
  }) {
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

      // Build the price submission
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
}
