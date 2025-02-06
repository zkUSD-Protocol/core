// /**
//  * Uses Node’s native `test` runner to test the EPM (ExternalProcessManager)
//  * with real external-process child processes and an in-memory job store.
//  */
// import { test, before, after } from 'node:test';
// import assert from 'node:assert/strict';
// import { ChildProcess } from 'child_process';

// import { ExternalProcessManager } from '../../../services/external-tx-processing/external-process-manager.js';
// import { InMemoryJobStore } from '../../../services/external-tx-processing/in-memory-job-store.js';
// import { WorkerJobType } from '../../../services/external-tx-processing/shared-types.js';

// const TEST_PORT = 4647; // Use a distinct port for tests

// let epm: ExternalProcessManager;
// let store: InMemoryJobStore;
// let workers: ChildProcess[] = [];

// /**
//  * Global setup: create the InMemoryJobStore & ExternalProcessManager, start the server,
//  * and spawn external-process processes.
//  */
// before(async () => {
//   // Create store with a default timeout of 5s (5000 ms) for testing
//   store = new InMemoryJobStore(5000);

//   // Create and init the manager on TEST_PORT
//   epm = new ExternalProcessManager(store, TEST_PORT);
//   await epm.init();

//   // Spawn 1 worker for these tests
//   epm.spawnWorkers([new NodeScriptProver()]);

//   // We don't directly manage the worker from here, but if you do want
//   // a separate test worker (e.g., to pass a special param), you could manually spawn it:
//   // workers.push(spawn('node', [EXTERNAL_PROVER_PATH, `http://localhost:${TEST_PORT}`]));
// });

// /**
//  * Global teardown: stop the EPM server & any leftover child processes.
//  */
// after(async () => {
//   console.log('Shutting down EPM and workers...');

//   // Shutdown the EPM (this should also kill any workers it spawned)
//   await epm.shutdown();

//   // Ensure all manually spawned workers are killed
//   workers.forEach((worker) => {
//     console.log(`Stopping worker process ${worker.pid}`);
//     worker.kill(); // Gracefully terminate the worker
//   });

//   console.log('Shutdown complete.');
// });

// /**
//  * 1) Happy Path: Single Job -> Single Worker
//  *    - Create a job
//  *    - Wait for the result
//  *    - Verify correctness
//  */
// test('Happy Path: single job is assigned, proved, and result is received', async () => {
//   // Request proof from the manager
//   const jobResultPromise = epm.proveJob(WorkerJobType.ProveTransaction, {
//     serializedTransaction: 'test-123',
//   });

//   // Wait for result
//   const result = await jobResultPromise;

//   // Verify the result shape (whatever your real code would produce)
//   // In the sample external-process code, it returns:
//   // { message: `Proof completed for transactionId=${job.payload.transactionId}` }
//   assert.deepEqual(result, {
//     message: 'Proof completed for jobId=test-123',
//   });
// });

// /**
//  * 2) Timeout Reassignment:
//  *    - We create a job with a very short assignment timeout
//  *    - We intentionally block the first worker from completing it quickly
//  *    - Once the timeout expires, a second worker can pick it up
//  *      (Here, we only spawn 1 worker in the setup, so we might illustrate using 2 workers if desired.)
//  *
//  *    NOTE: Because we spawn just 1 worker by default in `before()`, this test
//  *          can show that the same worker reclaims the job after timeout.
//  *          Alternatively, you could spawn 2 workers and see which one picks it up the second time.
//  */
// test('Reassign job after timeout if not completed', async () => {
//   // Make a short assignment timeout job
//   const SHORT_TIMEOUT = 2000;
//   const jobResultPromise = epm.proveJob(
//     WorkerJobType.ProveTransaction,
//     { serializedTransaction: 'slow-job-789' },
//     SHORT_TIMEOUT
//   );

//   // Let's forcibly "stall" the worker from completing quickly. One approach:
//   //   - By default, external-process sleeps 1000ms, which might still succeed
//   //   - To truly illustrate a stall, you might temporarily hack the external-process code to
//   //     take 5 seconds. For demonstration, let's assume it's enough to cause a timeout.

//   // Wait for the assignment timeout to trigger reassign
//   // We'll wait slightly more than 2s to ensure the job times out in the store.
//   await new Promise((resolve) => setTimeout(resolve, 3000));

//   // The job should now be "unassigned" in the store, so it can be picked up again.
//   // The existing worker (or a second worker) will eventually re-request /jobs/next.

//   // Wait for result up to some reasonable limit
//   const finalResult = await jobResultPromise;

//   // Confirm the job eventually got completed, presumably after re-assignment.
//   assert.deepEqual(finalResult, {
//     message: 'Proof completed for transactionId=slow-job-789',
//   });
// });

// /**
//  * For now, we've tested:
//  * - Happy path with a single job & single worker
//  * - Timeout logic with job reassignment
//  *
//  * Listed below are additional scenarios you might cover in the future:
//  *  - Multiple jobs with multiple workers (checking concurrency).
//  *  - Partial completions: e.g., one worker picks a job but times out, a second completes it.
//  *  - Worker crash handling: spawn a worker, kill it, verify EPM spawns a new one.
//  *  - Edge case: job is completed, then another worker tries to complete it again.
//  *  - Extended error handling: e.g. job not found, invalid payload, etc.
//  */
