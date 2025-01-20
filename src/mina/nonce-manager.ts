import { Account, Field, PublicKey, UInt32 } from "o1js";
import { GqlData, GqlQuery, GqlQueryCall, GqlVars, PooledNoncesQuery, mkPooledNoncesQuery } from "./graphql.js";
import { Mutex } from "../utils/mutex.js";


interface INonceManager {
  getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<NonceLock>;
}


interface NonceManagerConfig {
  fetchAccount(publicKey: string | PublicKey, tokenId?: Field): Promise<void>;
  getAccount(publicKey: PublicKey, tokenId?: Field): Promise<Account>;
  queryGraphQL<T extends GqlQuery<any, any>>(
    gqlCall: GqlQueryCall<GqlData<T>, GqlVars<T>>,
  ): Promise<GqlData<T>>;

}

type NonceLock = {
  nonce: UInt32;
  unlock: () => Promise<void>;
};

interface LocalNonceManagerConfig {
  fetchAccount(publicKey: string | PublicKey, tokenId?: Field): Promise<void>;
  getAccount(publicKey: PublicKey, tokenId?: Field): Promise<Account>;
}

class LocalNonceManager implements INonceManager {
  private _nonceManager: NonceManager;

  public constructor(config: LocalNonceManagerConfig) {
    const mockConfig = {
      fetchAccount: config.fetchAccount,
      getAccount: config.getAccount,
      queryGraphQL: (async () => {
        return {
          version: "MOCK",
          pooledZkappCommands: [],
          pooledUserCommands: [],
        }
      }) as <T extends GqlQuery<any, any>>(
        gqlCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
      ) => Promise<GqlData<T>>,
    }
    this._nonceManager = new NonceManager(mockConfig);
  }

  public async getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<NonceLock> {
    return this._nonceManager.getAccountNonce(publicKey, tokenId);
  }

}

class NonceManager implements INonceManager {
  private _config: NonceManagerConfig;
  private _accountLocks: Map<string, Set<UInt32>> = new Map();
  private _mutex = new Mutex();

  private async getHighestPooledNonce(publicKey: PublicKey, tokenId?: Field): Promise<bigint | undefined> {
    const q = mkPooledNoncesQuery({ pubkey: publicKey })
    const ret: PooledNoncesQuery = await this._config.queryGraphQL(q);

    let nonces: bigint[] = []
    if (tokenId) {
      nonces.push(...ret.pooledUserCommands.filter((cmd) => cmd.feePayer.tokenId === tokenId.toString()).map((cmd) => cmd.feePayer.nonce))
    }
    else {
      nonces.push(...ret.pooledUserCommands.map((cmd) => cmd.feePayer.nonce))
      nonces.push(...ret.pooledZkappCommands.map((cmd) => cmd.zkappCommand.feePayer.body.nonce))
    }
    if (nonces.length === 0) {
      return undefined
    }
    else {
      return nonces.reduce((a, b) => a > b ? a : b)
    }
  }

  public constructor(config: NonceManagerConfig) {
    this._config = config;
  }

  public async getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<NonceLock> {
    const pubKey = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;
    const keyString = `${pubKey.toBase58()}-${tokenId?.toString() ?? ""}`;


    const pooledNonce = await this.getHighestPooledNonce(pubKey, tokenId)
    let highNonce: UInt32;
    if (!pooledNonce) {
      await this._config.fetchAccount(publicKey, tokenId);
      const account = await this._config.getAccount(pubKey, tokenId);
      highNonce = account.nonce;
    } else {
      highNonce = new UInt32(pooledNonce+1n);
    }
    const mutex = this._mutex;
    const { nonce, unlock } = await mutex.runExclusive(() => {
      const lockSet = this._accountLocks.get(keyString);
      if (lockSet && lockSet.size > 0) {
        // get max nonce from lockSet
        let maxNonce = highNonce;
        lockSet.forEach((n) => {
          if (n.add(1).greaterThan(maxNonce)) {
            maxNonce = n.add(1);
          }
        });
        const nonce = maxNonce;
        lockSet.add(nonce);
        return {
          nonce, unlock: async () => {
            await mutex.runExclusive(() => {
              lockSet.delete(nonce);
            })
          }
        };
      }
      else {
        // new lock set
        const nonce = highNonce;
        const lockSet = new Set<UInt32>();
        lockSet.add(nonce);
        this._accountLocks.set(keyString, lockSet);
        return {
          nonce, unlock: async () => {
            await mutex.runExclusive(() => {
              lockSet.delete(nonce);
            })
          }
        };
      }
    });
    return { nonce, unlock }
  }

}

export { NonceLock, INonceManager, NonceManagerConfig, NonceManager, LocalNonceManager, LocalNonceManagerConfig };
