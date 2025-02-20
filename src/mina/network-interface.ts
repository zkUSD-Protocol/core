import {
  Mina,
  Lightnet,
  UInt32,
  PublicKey,
  Field,
  fetchAccount,
  Account as MinaAccount,
  UInt64,
} from 'o1js';
import {
  MinaNetwork,
  Local,
  Lightnet as LightnetNetwork,
  Devnet as DevnetNetwork,
} from './networks.js';
import { KeyPair, blockchain } from './../types/utility.js';
import {
  INonceManager,
  LocalNonceManager,
  NonceManager,
} from './nonce-manager.js';
import {
  GqlData,
  GqlQuery,
  GqlQueryCall,
  GqlVars,
  queryGraphQL,
} from './graphql.js';
import { extractAllTxParties } from './utils.js';
import { MinaZkappCommand } from '../o1js-compat/zkappcommand.js';
import { MinaApi } from './types.js';
import { fetchMinaAccount as zkcwfetchMinaAccount } from '../o1js-compat/zckw-fetch.js';

type LocalOnlyApi = {
  // add more as needed
  setBlockchainLength(height: UInt32): void;
};

/**
 * This type captures whatever methods come back from `Mina.Network()`.
 * For example, transaction(...), currentSlot(), etc.
 */
type ZkusdMinaApi = Omit<
  Awaited<ReturnType<typeof Mina.Network>>,
  'getAccount'
>;

class LocalBlockchain {
  kind: 'local' = 'local';
  _instance: Awaited<ReturnType<typeof Mina.LocalBlockchain>> | undefined;
  currentAccountIndex = 0;

  public get instance() {
    if (this._instance) {
      return this._instance;
    }
    throw new Error(
      'Instance not ready. Call await localBlockchain.init() first.'
    );
  }

  async init(opts?: {
    proofsEnabled?: boolean;
    enforceTransactionLimits?: boolean;
  }): Promise<void> {
    this._instance = await Mina.LocalBlockchain(opts);
  }

  async newAccount(): Promise<KeyPair> {
    if (this.currentAccountIndex >= 10) {
      throw new Error('Max number of local test accounts reached');
    }
    const t = this.instance.testAccounts[this.currentAccountIndex++];
    return {
      publicKey: t,
      privateKey: t.key,
    };
  }

  async moveChainForward(n: number = 1): Promise<void> {
    this.instance.setBlockchainLength(
      this.instance.getNetworkState().blockchainLength.add(n)
    );
  }

  get network(): MinaNetwork {
    return Local;
  }
}

/**
 * A simple helper for "lightnet" mode.
 * Also keeps its own .instance (MinaApi) and extra methods.
 */
class LightnetChain {
  kind: 'lightnet' = 'lightnet';
  private _instance: MinaApi | undefined;
  private _network: MinaNetwork = LightnetNetwork;

  public get instance() {
    if (this._instance) {
      return this._instance;
    }
    throw new Error(
      'Instance not ready. Call await localBlockchain.init() first.'
    );
  }

  async init(urls?: MinaNetwork): Promise<void> {
    this._network = urls ?? LightnetNetwork;
    this._instance = Mina.Network(this._network);
  }

  async newAccount(): Promise<KeyPair> {
    return Lightnet.acquireKeyPair();
  }

  async moveChainForward(_: number = 1): Promise<void> {
    throw new Error('moveChainForward not implemented for Lightnet (TODO)');
  }

  get network(): MinaNetwork {
    return this._network;
  }
}

/**
 * A simple helper for "devnet" mode.
 * Similar to LightnetChain but for devnet.
 */
class DevnetChain {
  kind: 'devnet' = 'devnet';
  private _instance: MinaApi | undefined;
  private _network: MinaNetwork = DevnetNetwork;

  public get instance() {
    if (this._instance) {
      return this._instance;
    }
    throw new Error('Instance not ready. Call await devnetChain.init() first.');
  }

  async init(urls?: MinaNetwork): Promise<void> {
    this._network = urls ?? DevnetNetwork;
    this._instance = Mina.Network(this._network);
  }

  async newAccount(): Promise<KeyPair> {
    throw new Error(
      'newAccount not implemented for Devnet - please create accounts externally'
    );
  }

  async moveChainForward(_: number = 1): Promise<void> {
    throw new Error('moveChainForward not implemented for Devnet');
  }

  get network(): MinaNetwork {
    return this._network;
  }
}

interface IMinaNetworkInterface extends ZkusdMinaApi {
  get slotDuration(): UInt64;
  get nonceManager(): INonceManager;
  get network(): MinaNetwork;
  get local(): LocalOnlyApi | undefined;
  fetchMinaAccount(
    publicKey: string | PublicKey,
    options?: { tokenId?: Field | string; force?: boolean }
  ): Promise<MinaAccount | undefined>;
  forceFetchAllTxParties(
    tx: Record<string, any> & { transaction: MinaZkappCommand }
  ): Promise<void>;
  newAccount(): Promise<KeyPair>;
  moveChainForward(n?: number): Promise<void>;
  Mina: typeof Mina;
  queryGraphQL<T extends GqlQuery<any, any>>(
    queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
  ): Promise<GqlData<T>>;
}

// exported singleton mina api helper that works with both local and lightnet
// to be the go-to class for interacting with the Mina blockchain (any network)
class MinaNetworkInterface implements IMinaNetworkInterface {
  public get local(): LocalOnlyApi | undefined {
    return this._local;
  }

  // The constructor is private to prevent direct instantiation.
  private constructor(
    private instance: MinaApi,
    private backend: LocalBlockchain | LightnetChain | DevnetChain,
    private _nonceManager: INonceManager,
    private _local?: LocalOnlyApi
  ) {}

  // We "declare" each property from MinaApi so TS knows we implement them.
  declare transaction: MinaApi['transaction'];
  declare currentSlot: MinaApi['currentSlot'];
  declare hasAccount: MinaApi['hasAccount'];
  declare fetchEvents: MinaApi['fetchEvents'];
  declare fetchActions: MinaApi['fetchActions'];
  declare getActions: MinaApi['getActions'];
  declare sendTransaction: MinaApi['sendTransaction'];
  declare getNetworkState: MinaApi['getNetworkState'];
  declare getNetworkConstants: MinaApi['getNetworkConstants'];
  declare getNetworkId: MinaApi['getNetworkId'];
  declare proofsEnabled: MinaApi['proofsEnabled'];
  public get Mina() {
    Mina.setActiveInstance(this.instance);
    return Mina;
  }

  public get slotDuration(): UInt64 {
    if (this.network.chainId === 'lightnet') {
      return UInt64.from(20 * 1000);
    }
    if (this.network.chainId === 'devnet') {
      return UInt64.from(180 * 1000);
    }
    throw new Error('slotDuration not implemented for this network');
  }

  private set nonceManager(nm: INonceManager) {
    this._nonceManager = nm;
  }

  public get nonceManager(): INonceManager {
    if (!this._nonceManager) {
      throw new Error('nonceManager not set');
    }
    return this._nonceManager;
  }

  /**
   * Create and initialize an instance of MinaNetworkInterface with a LocalBlockchain backend.
   * @param opts
   * @returns A newly initialized MinaNetworkInterface instance (local backend).
   */
  public static async initLocal(opts?: {
    proofsEnabled?: boolean;
    enforceTransactionLimits?: boolean;
  }): Promise<MinaNetworkInterface> {
    // Create and initialize the LocalBlockchain
    const local = new LocalBlockchain();
    await local.init(opts);

    // Create the new network interface instance
    const localNonceManager = new LocalNonceManager({
      fetchMinaAccount: async (publicKey, tokenId) => {
        return networkInterface.fetchMinaAccount(publicKey, {
          tokenId,
          force: true,
        });
      },
    });
    const networkInterface: MinaNetworkInterface = new MinaNetworkInterface(
      local.instance,
      local,
      localNonceManager,
      local.instance
    );

    // Switch the global "active" Mina instance
    Mina.setActiveInstance(networkInterface.instance);

    // Dynamically copy all methods from local.instance to this
    networkInterface.bindMethods();

    return networkInterface;
  }

  public static async initChain(
    chain: blockchain
  ): Promise<MinaNetworkInterface> {
    if (chain === 'local') {
      return await MinaNetworkInterface.initLocal();
    } else if (chain === 'lightnet') {
      return await MinaNetworkInterface.initLightnet();
    } else if (chain === 'devnet') {
      return await MinaNetworkInterface.initDevnet();
    } else {
      throw new Error(`Unsupported (yet) chain: ${chain}`);
    }
  }

  /* Fetch the Mina account for a given public key with error handling
   * via a zkCloudWorker's function.
   */
  public async fetchMinaAccount(
    publicKey: string | PublicKey,
    options?: { tokenId?: Field; force?: boolean }
  ): Promise<MinaAccount | undefined> {
    const ret = await zkcwfetchMinaAccount({
      publicKey:
        typeof publicKey === 'string'
          ? PublicKey.fromBase58(publicKey)
          : publicKey,
      tokenId: options?.tokenId,
      force: options?.force,
    });
    if ('account' in ret && ret.account) {
      return ret.account;
    } else {
      const pubkey =
        typeof publicKey === 'string'
          ? PublicKey.fromBase58(publicKey)
          : publicKey;

      try {
        return this.instance.getAccount(pubkey, options?.tokenId);
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Create and initialize an instance of MinaNetworkInterface with a LightnetChain backend.
   * @returns A newly initialized MinaNetworkInterface instance (lightnet backend).
   */
  public static async initLightnet(
    urls?: MinaNetwork
  ): Promise<MinaNetworkInterface> {
    // Create and initialize the LightnetChain
    const ln = new LightnetChain();
    await ln.init(urls);

    const nonceManager = new NonceManager({
      fetchMinaAccount: async (publicKey, tokenId) => {
        return networkInterface.fetchMinaAccount(publicKey, {
          tokenId,
          force: true,
        });
      },
      queryGraphQL: async (q) => {
        return networkInterface.queryGraphQL(q);
      },
    });

    // Create the new network interface instance
    const networkInterface: MinaNetworkInterface = new MinaNetworkInterface(
      ln.instance,
      ln,
      nonceManager
    );

    Mina.setActiveInstance(networkInterface.instance);

    // Dynamically copy all methods from ln.instance to this
    networkInterface.bindMethods();

    return networkInterface;
  }

  /**
   * Create and initialize an instance of MinaNetworkInterface with a DevnetChain backend.
   * @returns A newly initialized MinaNetworkInterface instance (devnet backend).
   */
  public static async initDevnet(
    urls?: MinaNetwork
  ): Promise<MinaNetworkInterface> {
    // Create and initialize the DevnetChain
    const devnet = new DevnetChain();
    await devnet.init(urls);

    const nonceManager = new NonceManager({
      fetchMinaAccount: async (publicKey, tokenId) => {
        return networkInterface.fetchMinaAccount(publicKey, {
          tokenId,
          force: true,
        });
      },
      queryGraphQL: async (q) => {
        return networkInterface.queryGraphQL(q);
      },
    });

    // Create the new network interface instance
    const networkInterface: MinaNetworkInterface = new MinaNetworkInterface(
      devnet.instance,
      devnet,
      nonceManager
    );

    Mina.setActiveInstance(networkInterface.instance);

    // Dynamically copy all methods from devnet.instance to this
    networkInterface.bindMethods();

    return networkInterface;
  }

  // ----------- queryGraphQL -----------

  async queryGraphQL<T extends GqlQuery<any, any>>(
    queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
  ): Promise<GqlData<T>> {
    return queryGraphQL(queryCall, this.network.mina[0]);
  }

  // ----

  async forceFetchAllTxParties(
    tx: Record<string, any> & { transaction: MinaZkappCommand }
  ): Promise<void> {
    let requests: Promise<any>[] = [];
    extractAllTxParties(tx.transaction).forEach(({ publicKey, tokenId }) => {
      requests.push(this.fetchMinaAccount(publicKey, { tokenId, force: true }));
    });
    await Promise.all(requests);
  }

  // ----------- Extra “backend” methods -----------
  async newAccount(): Promise<KeyPair> {
    return this.backend.newAccount();
  }

  async moveChainForward(n: number = 1): Promise<void> {
    return this.backend.moveChainForward(n);
  }

  get network(): MinaNetwork {
    return this.backend.network;
  }

  async fetchAccount(
    accountInfo: {
      publicKey: string | PublicKey;
      tokenId?: string | Field;
    },
    graphqlEndpoint?: string,
    options?: {
      timeout?: number | undefined;
    }
  ): Promise<
    | {
        account: MinaAccount;
        error: undefined;
      }
    | {
        account: undefined;
        error: {
          statusCode: number;
          statusText: string;
        };
      }
  > {
    return await fetchAccount(
      accountInfo,
      graphqlEndpoint ?? this.network.mina[0],
      { timeout: options?.timeout }
    );
  }

  // ----------- Bind all MinaApi methods -----------
  private bindMethods() {
    // Get all property names that exist directly on `this.instance`
    const propertyNames = Object.getOwnPropertyNames(this.instance);

    for (const name of propertyNames) {
      // Protect against weird properties like '__proto__'
      if (name === 'constructor' || name === '__proto__') continue;

      const descriptor = Object.getOwnPropertyDescriptor(this.instance, name);
      if (!descriptor) continue;

      // 1) If it's a function, bind it to `this.instance`.
      if (typeof descriptor.value === 'function') {
        (this as any)[name] = descriptor.value.bind(this.instance);
      }
      // 2) If it's an accessor (getter/setter), re-define it on `this`.
      else if (descriptor.get || descriptor.set) {
        Object.defineProperty(this, name, {
          get: descriptor.get?.bind(this.instance),
          set: descriptor.set?.bind(this.instance),
          enumerable: descriptor.enumerable ?? true,
          configurable: descriptor.configurable ?? true,
        });
      }
      // 3) Otherwise, it’s a normal value property—copy it over.
      else {
        (this as any)[name] = descriptor.value;
      }
    }
  }
}

export { MinaApi, LocalOnlyApi, IMinaNetworkInterface, MinaNetworkInterface };
