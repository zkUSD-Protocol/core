import { test } from 'node:test';
import { strict as assert } from 'assert';

import {
  NonceManager,
  NonceManagerConfig,
} from '../../../mina/nonce-manager.js';
import { PublicKey, UInt32, Account, PrivateKey, Field } from 'o1js';
import {
  GqlData,
  GqlQuery,
  GqlQueryCall,
  GqlVars,
} from '../../../mina/graphql.js';

/* -------------------------------------------------------------------------- */
/*                              Helper Utilities                              */
/* -------------------------------------------------------------------------- */

/**
 * Generates a random PublicKey using o1js's PrivateKey.
 */
const randomPublicKey = () => PrivateKey.random().toPublicKey();

/**
 * Utility to create a mock Account object.
 */
function toMockAccount(pubKey: PublicKey, nonce: UInt32): Account {
  return {
    publicKey: pubKey,
    nonce,
    balance: UInt32.from(1000),
  } as unknown as Account;
}

/**
 * Helper to create a mock NonceManagerConfig with overridable behaviors.
 */
function createMockConfig(
  chainNonce: UInt32,
  pooledUserCommands: Array<{
    feePayer: { nonce: bigint; tokenId?: string };
  }> = [],
  pooledZkappCommands: Array<{
    zkappCommand: { feePayer: { body: { nonce: bigint } } };
  }> = []
): NonceManagerConfig {
  return {
    async fetchMinaAccount(
      _publicKey: string | PublicKey,
      _tokenId?: string | Field
    ) {
      return toMockAccount(randomPublicKey(), chainNonce);
    },
    queryGraphQL: (async () => {
      return {
        version: 'TEST',
        pooledZkappCommands,
        pooledUserCommands,
      };
    }) as <T extends GqlQuery<any, any>>(
      gqlCall: GqlQueryCall<GqlData<T>, GqlVars<T>>
    ) => Promise<GqlData<T>>,
  };
}

/* -------------------------------------------------------------------------- */
/*                                Test Cases                                  */
/* -------------------------------------------------------------------------- */

test('NonceManager should return a nonce from on-chain if no pooled nonce is found', async () => {
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);

  const lock = await manager.getAccountNonce(randomPublicKey());
  assert.equal(lock.nonce.toString(), '5');

  await lock.unlock();
  await manager.dispose(); // Ensure cleanup job stops
});

test('NonceManager should pick the highest pooled nonce if present', async () => {
  const chainNonce = UInt32.from(5);
  const pooledNonce = 10n;

  const mockConfig = createMockConfig(chainNonce, [
    {
      feePayer: {
        nonce: pooledNonce,
        tokenId: '1',
      },
    },
  ]);

  const manager = new NonceManager(mockConfig);

  const lock = await manager.getAccountNonce(randomPublicKey());
  assert.equal(lock.nonce.toString(), '11'); // pooled nonce = 10 + 1 = 11

  await lock.unlock();
  await manager.dispose();
});

test('NonceManager should handle multiple calls by incrementing existing lock set', async () => {
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), '5');

  const lock2 = await manager.getAccountNonce(pubKey);
  assert.equal(lock2.nonce.toString(), '6');

  await lock1.unlock();
  await lock2.unlock();
  await manager.dispose();
});

test('NonceManager unlock should free the nonce set, and the cleanup job should stop if no locks remain', async () => {
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), '5');

  await lock1.unlock();

  // The lock set should be empty; the cleanup job should have stopped
  assert.strictEqual(
    manager['_cleanupInterval'],
    null,
    'Cleanup job should stop when no locks remain'
  );

  await manager.dispose();
});

test('NonceManager cleanup job should restart when a new lock set is created', async () => {
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), '5');

  await lock1.unlock();

  // Ensure the cleanup job has stopped after unlocking
  assert.strictEqual(
    manager['_cleanupInterval'],
    null,
    'Cleanup job should stop after unlocking all locks'
  );

  // Acquire a new lock, which should restart the cleanup job
  const lock2 = await manager.getAccountNonce(pubKey);
  assert.notStrictEqual(
    manager['_cleanupInterval'],
    null,
    'Cleanup job should restart when a new lock set is created'
  );

  await lock2.unlock();
  await manager.dispose();
});

test('NonceManager should clear stale locks after inactivity and stop the cleanup job', async () => {
  const chainNonce = UInt32.from(5);
  const manager = new NonceManager({
    ...createMockConfig(chainNonce),
    cleanupIntervalMs: 50, // Check for stale locks every 50 ms
    lockSetTimeoutMs: 100, // Consider locks stale after 100 ms
  });

  const pubKey = randomPublicKey();

  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), '5');

  // Wait long enough for the lock set to become stale
  await new Promise((resolve) => setTimeout(resolve, 150));

  // The lock set should have been cleared
  assert.strictEqual(
    manager['_accountLocks'].size,
    0,
    'Stale lock set should have been cleared'
  );

  // The cleanup job should have stopped after clearing the stale lock set
  assert.strictEqual(
    manager['_cleanupInterval'],
    null,
    'Cleanup job should stop after clearing all stale locks'
  );

  await lock1.unlock();
  await manager.dispose();
});

test('NonceManager should not remove active locks during cleanup', async () => {
  const chainNonce = UInt32.from(5);
  const manager = new NonceManager({
    ...createMockConfig(chainNonce),
    cleanupIntervalMs: 50, // Check for stale locks every 50 ms
    lockSetTimeoutMs: 200, // Consider locks stale after 200 ms
  });

  const pubKey1 = randomPublicKey();
  const pubKey2 = randomPublicKey();

  // Acquire two locks
  const lock1 = await manager.getAccountNonce(pubKey1); // Lock for pubKey1
  assert.equal(lock1.nonce.toString(), '5');

  const lock2 = await manager.getAccountNonce(pubKey2); // Lock for pubKey2
  assert.equal(lock2.nonce.toString(), '5');

  // Wait for less than the stale timeout (e.g., 100ms)
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Ensure that the cleanup job does not remove active locks
  assert.strictEqual(
    manager['_accountLocks'].size,
    2,
    'Active locks should not be removed by cleanup'
  );

  // Wait for longer than the stale timeout (e.g., 300ms)
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Only locks that are stale (in this case, both if unlocked after waiting) should be cleared
  assert.strictEqual(
    manager['_accountLocks'].size,
    0,
    'Stale locks should be removed after timeout'
  );

  // Unlock locks
  await lock1.unlock();
  await lock2.unlock();

  await manager.dispose();
});
