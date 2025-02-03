import {
  AccountUpdate,
  Bool,
  fetchLastBlock,
  Field,
  IncludedTransaction,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
  VerificationKey,
} from 'o1js';

import { Vault, VaultState } from '../types/vault.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';

import { FungibleTokenContract } from '@minatokens/token';
import {
  IMinaNetworkInterface,
  MinaNetworkInterface,
} from '../mina/mina-network-interface.js';
import { AgentKeys, NetworkKeyPairs, getNetworkKeys } from '../config/keys.js';
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
import { ContractInstance, KeyPair } from '../types/utility.js';
import { OracleWhitelist } from '../types/oracle.js';
import crypto from 'crypto';
import { ProtocolData } from '../types/engine.js';
import {
  ITransactionExecutor,
  LocalTransactionExecutor,
} from '../mina/transaction-executor.js';

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

export class TestHelper {
  protocolResumeCounter = 0;
  protocolStopCounter = 0;
  mina: IMinaNetworkInterface;
  _txMgr: TransactionManager;
  _deploymentService: DeploymentService;

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
    },
    callDepth = 3
  ) {
    const keys = 'keys' in sender ? sender.keys : sender;
    return this.txMgr.tx(keys, callback, options, callDepth);
  }

  public async includeTx(
    sender: AgentKeys | KeyPair, // TODO: future: avoid passing the private key
    callback: () => Promise<void>,
    options?: TransactionOptions & {
      name?: string;
      waitForIncluded?: (string | TransactionHandle)[];
      startingFee?: UInt64;
    },
    callDepth = 4
  ): Promise<IncludedTransaction> {
    let startingFee: UInt64 | undefined;

    if (this._txMgr.mina.network.chainId === 'local') {
      startingFee = new UInt64(0);
    }

    const h = await this.tx(
      sender,
      callback,
      {
        ...options,
        startingFee: options?.startingFee ?? startingFee,
      },
      callDepth
    );
    return await h.awaitIncluded();
  }

  static async initLocalChain(opts?: {
    txExecutor?: ITransactionExecutor;
    proofsEnabled?: boolean | undefined;
    enforceTransactionLimits?: boolean | undefined;
  }) {
    const mina = await MinaNetworkInterface.initLocal(opts);
    const deployer = await mina.newAccount();
    return new TestHelper(
      mina,
      opts?.txExecutor ?? new LocalTransactionExecutor(),
      deployer
    );
  }

  static async initLightnetChain(opts?: { txExecutor?: ITransactionExecutor }) {
    await ensureLightnetRunning();
    const mina = await MinaNetworkInterface.initLightnet();
    const deployer = await mina.newAccount();

    return new TestHelper(
      mina,
      opts?.txExecutor ?? new LocalTransactionExecutor(),
      deployer
    );
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
        }
      );
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

  async depositAgentCollateral(amount: UInt64, ...names: string[]) {
    const agentDepositTxs: TransactionHandle[] = [];

    for (const name of names) {
      const agent: AgentKeys | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vault = await this.retrieveVaultState(name);

      if (vault.collateralAmount.toBigInt() >= amount.toBigInt()) {
        continue;
      }

      const tx = await this.tx(
        agent.keys,
        async () => {
          await this.engine.contract.depositCollateral(
            agent.vault!.publicKey,
            amount
          );
        },
        { name: `Depositing ${amount} collateral for ${name}` }
      );
      agentDepositTxs.push(tx);
    }

    return await Promise.all(agentDepositTxs.map((t) => t.awaitIncluded()));
  }

  async mintAgentZkUsd(amount: UInt64, ...names: string[]) {
    const agentMintTxs: TransactionHandle[] = [];

    let oneUsd: MinaPriceInput | undefined;

    for (const name of names) {
      const agent: AgentKeys | undefined = this.agents[name];
      if (!agent) {
        throw new Error(`Agent ${name} not found`);
      }

      const vault = await this.retrieveVaultState(name);

      if (vault.debtAmount.toBigInt() >= amount.toBigInt()) {
        continue;
      }

      if (!oneUsd) {
        oneUsd = await this.getMinaPriceInput(TestAmounts.PRICE_10_USD);
      }

      const tx = await this.tx(
        agent.keys,
        async () => {
          await this.engine.contract.mintZkUsd(
            agent.vault!.publicKey,
            amount,
            oneUsd!
          );
        },
        { name: `Minting ${amount} zkUSD for ${name}` }
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

      const tx = await this.tx(
        agent.keys,
        async () => {
          AccountUpdate.fundNewAccount(agent.keys.publicKey, 2);
          await this.engine.contract.createVault(agent.vault!.publicKey);
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
        name: `Resume the protocol #${this.protocolResumeCounter}`,
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
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

  async getMinaPriceInput(price: UInt64, blockHeight?: UInt32) {
    if (!blockHeight) {
      if (this.mina.network.chainId === 'local') {
        blockHeight = this.mina.getNetworkState().blockchainLength;
      } else {
        blockHeight = (await fetchLastBlock()).blockchainLength;
      }
    }

    console.log(
      'Building mina price input for block height:',
      blockHeight.toBigint()
    );

    const oraclePriceSubmissions = await this.getPriceSubmissions({
      oraclePrice: price,
      blockHeight,
    });

    const oracleWhitelistHash = OracleWhitelist.hash(this.whitelist);

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

  public async retrieveVaultState(agentName: string): Promise<VaultState> {
    if (!this.agents[agentName]) {
      throw new Error(`Agent ${agentName} not found`);
    }

    const vaultAccount = await this.mina.fetchMinaAccount(
      this.agents[agentName].vault!.publicKey,
      {
        tokenId: this.engine.contract.deriveTokenId(),
        force: true,
      }
    );

    if (!vaultAccount) {
      throw new Error(`Vault for ${agentName} does not exist`);
    }

    return Vault.fromAccount(vaultAccount);
  }

  async printAgentState() {
    console.log('\n=== Agent States ===\n');

    for (const name of Object.keys(this.agents)) {
      const agent = this.agents[name];
      const vault = await this.retrieveVaultState(name);

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
    txExecutor: ITransactionExecutor,
    deployer: KeyPair
  ) {
    this.mina = mina;
    this._txMgr = TransactionManager.new(mina, txExecutor);
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
