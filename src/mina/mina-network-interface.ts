import {
  Mina,
  Lightnet,
  UInt32,
  PublicKey,
  Field,
  fetchAccount,
  Account,
} from 'o1js';
import { MinaNetwork, Local, Lightnet as LightnetNetwork } from './networks.js';
import { KeyPair } from './../types.js';
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
import { fetchMinaAccount as zkCWfetchMinaAccount } from 'zkcloudworker';

type LocalOnlyApi = {
  // add more as needed
  setBlockchainLength(height: UInt32): void;
};

/**
 * This type captures whatever methods come back from `Mina.Network()`.
 * For example, transaction(...), currentSlot(), etc.
 */
type MinaApi = Awaited<ReturnType<typeof Mina.Network>>;
type ZkusdMinaApi = Omit<
  Awaited<ReturnType<typeof Mina.Network>>,
  'getAccount'
>;

class LocalBlockchain {
  kind: 'local' = 'local';
  instance: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;
  currentAccountIndex = 0;

  async init(opts?: {
    proofsEnabled?: boolean;
    enforceTransactionLimits?: boolean;
  }): Promise<void> {
    this.instance = await Mina.LocalBlockchain(opts);
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
  instance: MinaApi;

  async init(): Promise<void> {
    this.instance = Mina.Network(this.network);
  }

  async newAccount(): Promise<KeyPair> {
    return Lightnet.acquireKeyPair();
  }

  async moveChainForward(_: number = 1): Promise<void> {
    throw new Error('moveChainForward not implemented for Lightnet (TODO)');
  }

  get network(): MinaNetwork {
    return LightnetNetwork;
  }
}

interface IMinaNetworkInterface extends ZkusdMinaApi {
  get nonceManager(): INonceManager;
  get network(): MinaNetwork;
  get local(): LocalOnlyApi | undefined;
  fetchMinaAccount(
    publicKey: string | PublicKey,
    options?: { tokenId?: Field | string; force?: boolean }
  ): Promise<Account | undefined>;
  newAccount(): Promise<KeyPair>;
  moveChainForward(n?: number): Promise<void>;
}

// exported singleton mina api helper that works with both local and lightnet
// to be the go-to class for interacting with the Mina blockchain (any network)
class MinaNetworkInterface implements IMinaNetworkInterface {
  private instance: MinaApi;
  private backend: LocalBlockchain | LightnetChain;
  private _nonceManager: INonceManager;
  private _local?: LocalOnlyApi;

  public get local(): LocalOnlyApi | undefined {
    return this._local;
  }

  // The constructor is private to prevent direct instantiation.
  private constructor() {}

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
    const networkInterface = new MinaNetworkInterface();
    networkInterface.backend = local;
    networkInterface.instance = local.instance;
    networkInterface._local = local.instance;

    // Set the nonce manager
    networkInterface._nonceManager = new LocalNonceManager({
      fetchMinaAccount: async (publicKey, tokenId) => {
        return networkInterface.fetchMinaAccount(publicKey, {
          tokenId,
          force: true,
        });
      },
    });

    // Switch the global "active" Mina instance
    Mina.setActiveInstance(networkInterface.instance);

    // Dynamically copy all methods from local.instance to this
    networkInterface.bindMethods();

    return networkInterface;
  }

  /* Fetch the Mina account for a given public key with error handling
   * via a zkCloudWorker's function.
   */
  public async fetchMinaAccount(
    publicKey: string | PublicKey,
    options?: { tokenId?: Field | string; force?: boolean }
  ): Promise<Account | undefined> {
    const ret = await zkCWfetchMinaAccount({
      publicKey,
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
      const tokenId: Field | undefined =
        typeof options?.tokenId === 'string'
          ? Field.from(options?.tokenId)
          : options?.tokenId;
      return this.instance.getAccount(pubkey, tokenId);
    }
  }

  /**
   * Create and initialize an instance of MinaNetworkInterface with a LightnetChain backend.
   * @returns A newly initialized MinaNetworkInterface instance (lightnet backend).
   */
  public static async initLightnet(): Promise<MinaNetworkInterface> {
    // Create and initialize the LightnetChain
    const ln = new LightnetChain();
    await ln.init();

    // Create the new network interface instance
    const networkInterface = new MinaNetworkInterface();
    networkInterface.backend = ln;
    networkInterface.instance = ln.instance;

    // Set the nonce manager
    networkInterface._nonceManager = new NonceManager({
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

    // Switch the global "active" Mina instance
    Mina.setActiveInstance(networkInterface.instance);

    // Dynamically copy all methods from ln.instance to this
    networkInterface.bindMethods();

    return networkInterface;
  }
  // ----------- queryGraphQL -----------

  async queryGraphQL<T extends GqlQuery<any, any>>(
    queryCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
  ): Promise<GqlData<T>> {
    return queryGraphQL(queryCall, this.network.mina[0]);
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
