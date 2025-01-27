import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Mutex } from '../../../utils/mutex.js';

test('should lock and release without errors', async () => {
  const mutex = new Mutex();
  await mutex.acquire();
  assert.doesNotThrow(() => mutex.release());
});

test('should throw an error if releasing an unlocked mutex', () => {
  const mutex = new Mutex();
  assert.throws(
    () => mutex.release(),
    /Cannot release a mutex that is not locked/
  );
});

test('should queue tasks and execute them in order', async () => {
  const mutex = new Mutex();
  const results: number[] = [];

  const task = async (id: number) => {
    await mutex.acquire();
    try {
      results.push(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      mutex.release();
    }
  };

  await Promise.all([task(1), task(2), task(3)]);
  assert.deepStrictEqual(results, [1, 2, 3]);
});

test('should use runExclusive to manage the mutex safely', async () => {
  const mutex = new Mutex();
  const results: number[] = [];

  const task = async (id: number) => {
    await mutex.runExclusive(async () => {
      results.push(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };

  await Promise.all([task(1), task(2), task(3)]);
  assert.deepStrictEqual(results, [1, 2, 3]);
});

test('should ensure critical section is exclusive', async () => {
  const mutex = new Mutex();
  let inCriticalSection = false;

  const task = async () => {
    await mutex.runExclusive(async () => {
      assert.strictEqual(inCriticalSection, false);
      inCriticalSection = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
      inCriticalSection = false;
    });
  };

  await Promise.all([task(), task(), task()]);
});

test('should return the value from runExclusive if callback returns a value', async () => {
  const mutex = new Mutex();
  const result = await mutex.runExclusive<number>(() => {
    return 42;
  });
  assert.strictEqual(result, 42);
});

test('should release the mutex if runExclusive callback throws, allowing subsequent calls', async () => {
  const mutex = new Mutex();

  const errorTask = async () => {
    await mutex.runExclusive(() => {
      throw new Error('Intentional error');
    });
  };

  await assert.rejects(errorTask, /Intentional error/);

  const result = await mutex.runExclusive(() => 'Success after error');
  assert.strictEqual(result, 'Success after error');
});

test('should handle very short lock times correctly with runExclusive', async () => {
  const mutex = new Mutex();
  let counter = 0;
  const totalTasks = 20;

  const tasks = Array.from({ length: totalTasks }, (_, index) => {
    return mutex.runExclusive(async () => {
      // If there's a bug in short lock times, we might see concurrency issues.
      // For the sake of demonstration, just increment a shared counter.
      const current = counter;
      // Very short "critical section" — no artificial delay here
      counter = current + 1;
    });
  });

  await Promise.all(tasks);

  // If everything works correctly under short lock times,
  // the counter should match the total number of tasks.
  assert.strictEqual(counter, totalTasks);
});

test('should work as expected during concurrency pressure', async () => {
  const mutex = new Mutex();

  const NUM_WORKERS = 10; // Number of parallel worker loops
  const MAX_TIME_MS = 2000; // Total time to try (5 seconds)
  let concurrencyBugDetected = false;
  let activeCount = 0;

  // Record the start time
  const start = Date.now();

  // A worker repeatedly acquires/releases the lock with random delays
  async function worker() {
    while (true) {
      // Stop if we've triggered the bug or we ran out of time
      if (concurrencyBugDetected || Date.now() - start > MAX_TIME_MS) {
        break;
      }

      // Random delay before acquiring the lock (0-5 ms)
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6)));

      // Acquire the lock
      await mutex.acquire();
      try {
        // Enter the critical section
        activeCount++;

        // If activeCount > 1, we've just witnessed concurrency in the critical section
        if (activeCount > 1) {
          concurrencyBugDetected = true;
        }

        // Short random work inside the critical section (0-5 ms)
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6)));
      } finally {
        activeCount--;
        mutex.release();
      }
    }
  }

  // Spawn multiple workers
  const workers = Array.from({ length: NUM_WORKERS }, () => worker());

  // Race between:
  // 1) All workers finishing (they won't actually finish unless we exit early),
  //    but let's keep them around so we can cancel them if we detect the bug or time out.
  // 2) A timeout after 5 seconds if the bug wasn't detected.
  await Promise.race([
    (async () => {
      await Promise.all(workers);
    })(),
    (async () => {
      // Wait for 5 seconds
      await new Promise((resolve) => setTimeout(resolve, MAX_TIME_MS));
      // If after 5 seconds, no bug was detected, fail the test
      if (concurrencyBugDetected) {
        assert.fail('Concurrency bug detected');
      }
    })(),
  ]);

  // If we break out of the workers because concurrencyBugDetected == true,
  // then we've triggered the race condition.
  // We can confirm by asserting it here. We "expect" the bug to appear:
  assert.ok(!concurrencyBugDetected, 'Concurrency issues detected');
});
