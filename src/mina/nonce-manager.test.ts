// nonce-manager.test.ts

import { test } from "node:test";
import { strict as assert } from "assert";

import { NonceManager, NonceLock, INonceManager, NonceManagerConfig } from "./nonce-manager.js";
import { PublicKey, Field, UInt32, Account, PrivateKey } from "o1js";
import { GqlData, GqlQuery, GqlQueryCall, GqlVars } from "./graphql.js";

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
  // Casting as `unknown` and then `Account` to avoid direct TS mismatch
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
  pooledUserCommands: Array<{ feePayer: { nonce: bigint; tokenId?: string } }> = [],
  pooledZkappCommands: Array<{ zkappCommand: { feePayer: { body: { nonce: bigint } } } }> = []
): NonceManagerConfig {
  return {
    async fetchAccount(_publicKey: string | PublicKey) {
      // No-op by default
    },
    async getAccount(_publicKey: string | PublicKey) {
      return toMockAccount(randomPublicKey(), chainNonce);
    },
    queryGraphQL: (async () => {
      return {
        version: "TEST",
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

test("NonceManager should return a nonce from on-chain if no pooled nonce is found", async () => {
  // chain nonce is 5, no pooled transactions
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  // Create the NonceManager
  const manager = new NonceManager(mockConfig);

  // Act
  const lock = await manager.getAccountNonce(randomPublicKey());

  // Assert - chain nonce = 5 => +1 => 6
  assert.equal(lock.nonce.toString(), "6");

  await lock.unlock();
});

test("NonceManager should pick the highest pooled nonce if present", async () => {
  // chain nonce is 5, but we have a pooled user command with nonce = 10
  const chainNonce = UInt32.from(5);
  const pooledNonce = 10n;

  const mockConfig = createMockConfig(chainNonce, [
    {
      feePayer: {
        nonce: pooledNonce,
        tokenId: "1",
      },
    },
  ]);

  const manager = new NonceManager(mockConfig);

  // Act
  const lock = await manager.getAccountNonce(randomPublicKey());

  // Assert - pooled nonce = 10 => +1 => 11
  assert.equal(lock.nonce.toString(), "11");

  await lock.unlock();
});

test("NonceManager should handle multiple calls by incrementing existing lock set", async () => {
  // chain nonce is 5, no pooled transactions
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  // First call => 5 + 1 = 6
  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), "6");

  // Second call => picks up from 6 => +1 => 7
  const lock2 = await manager.getAccountNonce(pubKey);
  assert.equal(lock2.nonce.toString(), "7");

  await lock1.unlock();
  await lock2.unlock();
});

test("NonceManager unlock should free the nonce set, but chain nonce remains the same", async () => {
  // chain nonce = 5, no pooled tx
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  // First call => 6
  const lock1 = await manager.getAccountNonce(pubKey);
  assert.equal(lock1.nonce.toString(), "6");

  // Unlock => removes it from the lock set
  await lock1.unlock();

  // Second call => the lock set is empty, chain nonce still 5 => +1 => 6 again
  const lock2 = await manager.getAccountNonce(pubKey);
  assert.equal(lock2.nonce.toString(), "6");

  await lock2.unlock();
});

test("NonceManager concurrency test: two parallel calls yield consecutive nonces", async () => {
  // chain nonce = 5, no pooled tx
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  // Act: parallel calls
  const [lockA, lockB] = await Promise.all([
    manager.getAccountNonce(pubKey),
    manager.getAccountNonce(pubKey),
  ]);

  const nonceA = parseInt(lockA.nonce.toString(), 10);
  const nonceB = parseInt(lockB.nonce.toString(), 10);

  // Assert - distinct consecutive values => 6 and 7
  assert.notEqual(nonceA, nonceB, "Nonces in parallel calls must be unique");

  await lockA.unlock();
  await lockB.unlock();
});


test("NonceManager concurrency test: two parallel calls yield consecutive nonces", async () => {
  // chain nonce = 5, no pooled tx
  const chainNonce = UInt32.from(5);
  const mockConfig = createMockConfig(chainNonce);

  const manager = new NonceManager(mockConfig);
  const pubKey = randomPublicKey();

  // Act: parallel calls
  const [lockA, lockB] = await Promise.all([
    manager.getAccountNonce(pubKey),
    manager.getAccountNonce(pubKey),
  ]);

  const nonceA = parseInt(lockA.nonce.toString(), 10);
  const nonceB = parseInt(lockB.nonce.toString(), 10);

  // Assert - distinct consecutive values => 6 and 7
  assert.notEqual(nonceA, nonceB, "Nonces in parallel calls must be unique");

  await lockA.unlock();
  await lockB.unlock();
});
