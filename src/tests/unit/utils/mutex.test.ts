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
  assert.throws(() => mutex.release(), /Cannot release a mutex that is not locked/);
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
