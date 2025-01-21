import { Account, Field, PublicKey, UInt32 } from "o1js";
import {
  GqlData,
  GqlQuery,
  GqlQueryCall,
  GqlVars,
  PooledNoncesQuery,
  mkPooledNoncesQuery,
} from "./graphql.js";
import { Mutex } from "../utils/mutex.js";

/**
 * Represents a lock acquired for a nonce, containing the nonce value and
 * an `unlock` function to release the lock once done.
 */
export type NonceLock = {
  nonce: UInt32;
  unlock: () => Promise<void>;
};

/**
 * Defines the interface for managing account nonces and retrieving locked nonce values.
 */
export interface INonceManager {
  /**
   * Retrieves a nonce for the specified account and token ID, and locks it.
   *
   * @param publicKey - The public key of the account.
   * @param tokenId - Optional token ID (defaults to the MINA token if not provided).
   * @returns A `NonceLock` containing the locked nonce and an unlock function.
   */
  getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<NonceLock>;

  /**
   * Disposes of the nonce manager, releasing any resources or locks.
   */
  dispose(): Promise<void>;

}

/**
 * The configuration required by `NonceManager`.
 */
export interface NonceManagerConfig {
  /**
   * Fetches the account details from the network or other service.
   * Typically triggers a side-effect such as loading the account state into a cache.
   */
  fetchAccount(publicKey: string | PublicKey, tokenId?: Field): Promise<void>;

  /**
   * Retrieves the in-memory (or locally cached) representation of the account.
   */
  getAccount(publicKey: PublicKey, tokenId?: Field): Promise<Account>;

  /**
   * Performs a GraphQL query to fetch pooled transactions.
   */
  queryGraphQL<T extends GqlQuery<any, any>>(
    gqlCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
  ): Promise<GqlData<T>>;
}

/**
 * The configuration for `LocalNonceManager`, which extends the basic requirement
 * to fetch and get account details, but mocks out the GraphQL behavior.
 */
export interface LocalNonceManagerConfig {
  fetchAccount(publicKey: string | PublicKey, tokenId?: Field): Promise<void>;
  getAccount(publicKey: PublicKey, tokenId?: Field): Promise<Account>;
}

/**
 * An implementation of `INonceManager` that delegates to a real `NonceManager` internally,
 * but mocks out the GraphQL queries (always returns empty pooled transactions).
 *
 * Useful for local testing scenarios where you don't need real GraphQL queries.
 */
export class LocalNonceManager implements INonceManager {
  private _nonceManager: NonceManager;

  public constructor(config: LocalNonceManagerConfig) {
    const mockConfig: NonceManagerConfig = {
      fetchAccount: config.fetchAccount,
      getAccount: config.getAccount,
      // Mock GraphQL queries to return empty results
      queryGraphQL: async () =>
        ({
          version: "MOCK",
          pooledZkappCommands: [],
          pooledUserCommands: [],
        } as any),
    };
    this._nonceManager = new NonceManager(mockConfig);
  }

  /**
   * Retrieves a locked nonce for a local (mock) environment.
   */
  public async getAccountNonce(
    publicKey: string | PublicKey,
    tokenId?: Field
  ): Promise<NonceLock> {
    return this._nonceManager.getAccountNonce(publicKey, tokenId);
  }

  /**
   * Disposes of the nonce manager, releasing any resources or locks.
   */
  public async dispose() {
    this._nonceManager.dispose();
  }
}

/**
 * Options for controlling the behavior of the `NonceManager`, including time-based cleanup.
 */
export interface NonceManagerOptions extends NonceManagerConfig {
  /**
   * Interval in milliseconds for checking and removing inactive lock sets.
   * Defaults to 60,000 ms (1 minute).
   */
  cleanupIntervalMs?: number;

  /**
   * Inactivity duration in milliseconds after which a lock set is considered stale.
   * Defaults to 300,000 ms (5 minutes).
   */
  lockSetTimeoutMs?: number;
}

/**
 * Maintains and manages nonces for various accounts, ensuring concurrency safety
 * through a mutex. Provides a mechanism to clear inactive lock sets automatically.
 */
/**
 * Maintains and manages nonces for various accounts, ensuring concurrency safety
 * through a mutex. Dynamically starts and stops the cleanup job based on active lock sets.
 */
export class NonceManager implements INonceManager {
  private _config: NonceManagerConfig;

  // Each entry in `_accountLocks` keeps track of:
  // - locks: Set of locked nonces
  // - lastActivity: timestamp (ms) of the last time a lock was acquired/used
  private _accountLocks: Map<
    string,
    {
      locks: Set<UInt32>;
      lastActivity: number;
    }
  > = new Map();

  private _mutex = new Mutex();
  private _cleanupIntervalMs: number;
  private _lockSetTimeoutMs: number;
  private _cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new instance of the NonceManager.
   *
   * @param options - The configuration options for the NonceManager.
   */
  public constructor(options: NonceManagerOptions) {
    this._config = {
      fetchAccount: options.fetchAccount,
      getAccount: options.getAccount,
      queryGraphQL: options.queryGraphQL,
    };

    // Lock set cleanup configuration
    this._cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000; // default 1 min
    this._lockSetTimeoutMs = options.lockSetTimeoutMs ?? 300_000; // default 5 min
  }

  /**
   * Starts the periodic cleanup interval if not already running.
   */
  private startCleanup() {
    if (this._cleanupInterval === null) {
      this._cleanupInterval = setInterval(
        () => this.cleanupStaleLockSets(),
        this._cleanupIntervalMs
      );
    }
  }

  /**
   * Stops the periodic cleanup interval if it is running.
   */
  private stopCleanup() {
    if (this._cleanupInterval !== null) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Dynamically manages the cleanup job based on the presence of lock sets.
   * If there are no lock sets, the cleanup job is stopped.
   */
  private manageCleanupJob() {
    if (this._accountLocks.size === 0) {
      this.stopCleanup();
    } else {
      this.startCleanup();
    }
  }

  /**
   * Fetches the highest pooled nonce for a given public key and optional token ID
   * via GraphQL.
   *
   * @param publicKey - The account's public key.
   * @param tokenId - Optional token ID.
   * @returns The highest nonce found among pooled transactions, or `undefined` if none.
   */
  private async getHighestPooledNonce(
    publicKey: PublicKey,
    tokenId?: Field
  ): Promise<bigint | undefined> {
    try {
      const q = mkPooledNoncesQuery({ pubkey: publicKey });
      const ret: PooledNoncesQuery = await this._config.queryGraphQL(q);

      const nonces = tokenId
        ? ret.pooledUserCommands
            .filter((cmd) => cmd.feePayer.tokenId === tokenId.toString())
            .map((cmd) => cmd.feePayer.nonce)
        : [
            ...ret.pooledUserCommands.map((cmd) => cmd.feePayer.nonce),
            ...ret.pooledZkappCommands.map(
              (cmd) => cmd.zkappCommand.feePayer.body.nonce
            ),
          ];

      if (nonces.length === 0) return undefined;
      return nonces.reduce((max, num) => (num > max ? num : max), nonces[0]);
    } catch (error) {
      console.error("Error fetching pooled nonces:", error);
      return undefined; // Fallback in case of errors
    }
  }

  /**
   * Retrieves and locks a nonce for a specific account and token ID.
   *
   * @param publicKey - The account's public key (string or PublicKey).
   * @param tokenId - Optional token ID (defaults to the MINA token).
   * @returns A `NonceLock` object with the locked nonce and an unlock function.
   */
  public async getAccountNonce(
    publicKey: string | PublicKey,
    tokenId?: Field
  ): Promise<NonceLock> {
    const pubKey = this.toPublicKey(publicKey);
    const keyString = `${pubKey.toBase58()}-${tokenId?.toString() ?? ""}`;

    // Get the highest nonce (pooled or account-based)
    const pooledNonce = await this.getHighestPooledNonce(pubKey, tokenId);
    let highNonce: UInt32;

    if (!pooledNonce) {
      try {
        // Load account data from the network/cache
        await this._config.fetchAccount(publicKey, tokenId);
        const account = await this._config.getAccount(pubKey, tokenId);
        highNonce = account.nonce;
      } catch (error) {
        throw new Error(`Failed to fetch account nonce: ${error}`);
      }
    } else {
      highNonce = new UInt32(pooledNonce + 1n);
    }

    // Locking logic using Mutex
    const { nonce, unlock } = await this._mutex.runExclusive(() => {
      const now = Date.now();

      // Retrieve or initialize the lock set for this account
      let lockSetData = this._accountLocks.get(keyString);
      if (!lockSetData) {
        lockSetData = { locks: new Set<UInt32>(), lastActivity: now };
        this._accountLocks.set(keyString, lockSetData);

        // Start the cleanup interval if it was stopped
        this.manageCleanupJob();
      }

      // Calculate the next available nonce, ensuring we don't re-use locked ones
      const maxNonceInSet =
        lockSetData.locks.size > 0
          ? Array.from(lockSetData.locks).reduce((max, n) => {
              const next = n.add(1);
              return next.greaterThan(max) ? next : max;
            }, highNonce)
          : highNonce;

      // Add the chosen nonce to the lock set and update activity timestamp
      lockSetData.locks.add(maxNonceInSet);
      lockSetData.lastActivity = now;

      // Return the locked nonce and the unlock function
      return {
        nonce: maxNonceInSet,
        unlock: async () => {
          // The unlock promise should never throw
          try {
            await this._mutex.runExclusive(() => {
              lockSetData!.locks.delete(maxNonceInSet);
              lockSetData!.lastActivity = Date.now();

              // If the lock set becomes empty, remove it
              if (lockSetData!.locks.size === 0) {
                this._accountLocks.delete(keyString);
                this.manageCleanupJob(); // Stop cleanup if no lock sets remain
              }
            });
          } catch (err) {
            console.error("Error unlocking nonce:", err);
          }
        },
      };
    });

    return { nonce, unlock };
  }

  /**
   * Periodically checks for stale lock sets (those with no activity for
   * `_lockSetTimeoutMs` milliseconds) and removes them.
   */
  private cleanupStaleLockSets() {
    const now = Date.now();
    for (const [key, lockSetData] of this._accountLocks.entries()) {
      if (now - lockSetData.lastActivity >= this._lockSetTimeoutMs) {
        this._accountLocks.delete(key);
      }
    }

    // Stop the cleanup interval if no lock sets remain
    this.manageCleanupJob();
  }

  /**
   * Converts a string or PublicKey to a PublicKey instance.
   *
   * @param input - Either a string or a PublicKey.
   * @returns The corresponding PublicKey object.
   */
  private toPublicKey(input: string | PublicKey): PublicKey {
    return typeof input === "string" ? new PublicKey(input) : input;
  }

  /**
   * Disposes of the nonce manager, releasing any resources or locks.
   */
  public async dispose() {
    this.stopCleanup();
    this._accountLocks.clear();
  }
}
