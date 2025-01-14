import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Sign,
  Signature,
  UInt64,
} from 'o1js';
import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import {
  ContractInstance,
  KeyPair,
  OraclePriceSubmissions,
  OracleWhitelist,
  PriceSubmission,
} from '../types.js';
import { FungibleTokenContract } from '@minatokens/token';
import { MinaChain } from '../mina.js';
import { NetworkKeyPairs, getNetworkKeys } from '../config/keys.js';
import { transaction } from '../utils/transaction.js';
import { deploy } from '../deploy.js';
import Client from 'mina-signer';

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

interface Agent {
  keys: KeyPair;
  vault?: {
    contract: ZkUsdVault;
    publicKey: PublicKey;
    privateKey: PrivateKey;
  };
}

export class TestHelper {
  chain = MinaChain;

  deployer: KeyPair;
  agents: Record<string, Agent> = {};
  oracles: Record<string, KeyPair> = {};

  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ReturnType<typeof ZkUsdEngineContract>>;

  vaultVerificationKeyHash?: Field;
  whitelist: OracleWhitelist = new OracleWhitelist({
    addresses: Array(OracleWhitelist.MAX_PARTICIPANTS).fill(PublicKey.empty()),
  });

  whitelistedOracles: Map<string, number> = new Map();

  get networkKeys(): NetworkKeyPairs {
    return getNetworkKeys(this.chain.network().chainId);
  }

  createVaultKeyPair(): { publicKey: PublicKey; privateKey: PrivateKey } {
    return PrivateKey.randomKeypair();
  }

  async initLocalChain(opts?: {
    proofsEnabled?: boolean | undefined;
    enforceTransactionLimits?: boolean | undefined;
  }) {
    await this.chain.initLocal(opts);
    this.deployer = await this.chain.newAccount();
  }

  async initLightnetChain() {
    await this.chain.initLightnet();
    this.deployer = await this.chain.newAccount();
  }

  async deployTokenContracts() {
    const deployedContracts = await deploy(this.chain, this.deployer);

    this.token = deployedContracts.token;
    this.engine = deployedContracts.engine;

    if (this.chain.network().chainId === 'local') {
      for (let i = 0; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
        const oracleName = 'oracle' + (i + 1);
        this.oracles[oracleName] = PrivateKey.randomKeypair();
        this.whitelist.addresses[i] = this.oracles[oracleName].publicKey;
        this.whitelistedOracles.set(oracleName, i);
      }

      await transaction(
        this.deployer,
        async () => {
          await this.engine.contract.updateOracleWhitelist(this.whitelist);
        },
        {
          extraSigners: [this.networkKeys.protocolAdmin.privateKey],
        }
      );
    }
  }

  async createAgents(names: string[]) {
    for (const name of names) {
      const keys = await this.chain.newAccount();
      this.agents[name] = { keys };
    }
  }

  async createVaults(names: string[]) {
    for (const name of names) {
      if (!this.agents[name]) {
        throw new Error(`Agent ${name} not found`);
      }

      const vaultKeyPair = this.createVaultKeyPair();

      this.agents[name].vault = {
        contract: new ZkUsdVault(
          vaultKeyPair.publicKey,
          this.engine.contract.deriveTokenId()
        ),
        publicKey: vaultKeyPair.publicKey,
        privateKey: vaultKeyPair.privateKey,
      };

      await transaction(
        this.agents[name].keys,
        async () => {
          AccountUpdate.fundNewAccount(this.agents[name].keys.publicKey, 2);
          await this.engine.contract.createVault(
            this.agents[name].vault!.publicKey
          );
        },
        {
          extraSigners: [this.agents[name].vault!.privateKey],
        }
      );
    }
  }

  async stopTheProtocol() {
    await transaction(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(true));
      },
      {
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  async resumeTheProtocol() {
    await transaction(
      this.deployer,
      async () => {
        await this.engine.contract.toggleEmergencyStop(Bool(false));
      },
      {
        extraSigners: [this.networkKeys.protocolAdmin.privateKey],
      }
    );
  }

  async getPriceSubmissions() {
    const price = UInt64.from(1e9);
    const fallbackPrice = UInt64.from(0.5e9);
    const blockHeight = Mina.getNetworkState().blockchainLength;

    const oraclePriceSubmissions: OraclePriceSubmissions = {
      submissions: [],
    };

    for (let i = 0; i < this.whitelist.addresses.length; i++) {
      const oracleName = 'oracle' + (i + 1);
      const oraclePrivateKey = this.oracles[oracleName].privateKey;
      const oraclePublicKey = oraclePrivateKey.toPublicKey();

      const signature = client.signFields(
        [price.toBigInt(), blockHeight.toBigint()],
        oraclePrivateKey.toBase58()
      );

      //build the price submission
      const priceSubmission = new PriceSubmission({
        publicKey: oraclePublicKey,
        signature: Signature.fromBase58(signature.signature),
        price: price,
        blockHeight: blockHeight,
      });

      oraclePriceSubmissions.submissions.push(priceSubmission);
    }

    const fallbackPriceSubmissionSignature = client.signFields(
      [price.toBigInt(), blockHeight.toBigint()],
      this.networkKeys.protocolAdmin.privateKey.toBase58()
    );

    const fallbackPriceSubmission = new PriceSubmission({
      publicKey: this.networkKeys.protocolAdmin.publicKey,
      signature: Signature.fromBase58(
        fallbackPriceSubmissionSignature.signature
      ),
      price: fallbackPrice,
      blockHeight: blockHeight,
    });

    return { oraclePriceSubmissions, fallbackPriceSubmission };
  }
}
