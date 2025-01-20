import { Mina, Lightnet, UInt32 } from 'o1js';
import { MinaNetwork, Local, Lightnet as LightnetNetwork } from './networks.js';
import { KeyPair } from './types.js';

/**
 * This type captures whatever methods come back from `Mina.Network()`.
 * For example, transaction(...), currentSlot(), etc.
 */
type MinaApi = Awaited<ReturnType<typeof Mina.Network>>;

export type LocalOnlyApi = {
  // add more as needed
  setBlockchainLength(height: UInt32): void;
}

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

  async moveChainForward(n: number=1): Promise<void> {
    this.instance.setBlockchainLength(
      this.instance.getNetworkState().blockchainLength.add(n)
    );
  }

  network(): MinaNetwork {
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
    this.instance = Mina.Network(this.network());
  }

  async newAccount(): Promise<KeyPair> {
    return Lightnet.acquireKeyPair();
  }

  async moveChainForward(_: number=1): Promise<void> {
    throw new Error('moveChainForward not implemented for Lightnet (TODO)');
  }

  network(): MinaNetwork {
    return LightnetNetwork;
  }
}

// exported singleton mina api helper that works with both local and lightnet
export class MinaChainInstance implements MinaApi {
  private instance: MinaApi;
  private backend: LocalBlockchain | LightnetChain;

  public local?: LocalOnlyApi;

  // We "declare" each property from MinaApi so TS knows we implement them.
  declare transaction: MinaApi['transaction'];
  declare currentSlot: MinaApi['currentSlot'];
  declare hasAccount: MinaApi['hasAccount'];
  declare getAccount: MinaApi['getAccount'];
  declare fetchEvents: MinaApi['fetchEvents'];
  declare fetchActions: MinaApi['fetchActions'];
  declare getActions: MinaApi['getActions'];
  declare sendTransaction: MinaApi['sendTransaction'];
  declare getNetworkState: MinaApi['getNetworkState'];
  declare getNetworkConstants: MinaApi['getNetworkConstants'];
  declare getNetworkId: MinaApi['getNetworkId'];
  declare proofsEnabled: MinaApi['proofsEnabled'];

  // ----------- Init local blockchain -----------
  async initLocal(opts?: {
    proofsEnabled?: boolean;
    enforceTransactionLimits?: boolean;
  }): Promise<void> {
    const local = new LocalBlockchain();
    await local.init(opts);

    // The local .instance is your real MinaApi
    this.backend = local;
    this.instance = local.instance;
    this.local = local.instance;

    // Switch the global "active" instance so .transaction calls, etc. refer to it
    Mina.setActiveInstance(this.instance);

    // Now dynamically copy all methods from local.instance => this
    this.bindMethods();
  }

  // ----------- Init/connect to the lightnet -----------
  async initLightnet(): Promise<void> {
    const ln = new LightnetChain();
    await ln.init();

    this.backend = ln;
    this.instance = ln.instance;

    Mina.setActiveInstance(this.instance);

    this.bindMethods();
  }

  // ----------- Extra “backend” methods -----------
  async newAccount(): Promise<KeyPair> {
    return this.backend.newAccount();
  }

  async moveChainForward(n: number=1): Promise<void> {
    return this.backend.moveChainForward(n);
  }

  network(): MinaNetwork {
    return this.backend.network();
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

// Export a singleton you can import anywhere
export const MinaChain = new MinaChainInstance();
