import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { TestHelper } from '../../test-helper.js';
import { LocalTransactionExecutor } from '../../../mina/local-transaction-executor.js';
import { KeyPair, singleDefault } from '../../../types/utility.js';
import {
  ITransactionStatusScanner,
  TransactionStatusScanner,
} from '../../../mina/transaction-status-scanner.js';
import { AccountUpdate, UInt32, UInt64, fetchLastBlock } from 'o1js';
import { TransactionHandle } from '../../../mina/transaction-manager.js';
import {
  TransactionStatus,
  statusIsOfKind,
} from '../../../mina/transaction-status.js';

describe('zkUSD Integration - Services - Transaction Status Scanner tests', () => {
  let th: TestHelper<'local'>;
  let statusScanner: ITransactionStatusScanner;
  let alice: KeyPair;
  let bob: KeyPair;

  before(async () => {
    // Initialize your local chain or test environment
    th = await TestHelper.initLightnetChain({
      txExecutorInitializers: singleDefault(
        'local',
        async () => new LocalTransactionExecutor()
      ),
    });

    // Instantiate the TransactionStatusScanner
    statusScanner = new TransactionStatusScanner(th.mina);

    // Start scanning in the background
    await statusScanner.startScanning();

    alice = await th.mina.newAccount();
    bob = await th.mina.newAccount();
  });

  after(async () => {
    // Stop scanning once all tests complete
    await statusScanner.stopScanning();
  });

  it('should eventually see a successfully included transaction', async () => {
    // 1) Send a transaction that we expect to succeed
    //    This is pseudo-code; replace with your actual transaction creation & broadcast

    const txh = await sendSuccessfulTx(th);

    const status1 = await txh.awaitStatusChange({
      until: (status: TransactionStatus) => statusIsOfKind(status, 'Pending'),
    });
    assert.equal(true, statusIsOfKind(status1, 'Pending'));

    // 2) Await the status from the scanner
    const status = await statusScanner.awaitTransactionStatus(
      txh.hash!,
      500_000
    ); // 1 min timeout

    // 3) Assert that the status is 'Included'
    assert.equal(status, 'Included');
  });

  it('should detect a transaction with a failure reason as "RejectedOnInclusion"', async () => {
    // 1) Send a transaction that deliberately fails
    //    Again, this is pseudo-code; you'd have to craft a transaction that fails on your network
    const txh = await sendFailingTx(th);

    const status1 = await txh.awaitStatusChange({
      until: (status: TransactionStatus) => statusIsOfKind(status, 'Pending'),
    });
    assert.equal(true, statusIsOfKind(status1, 'Pending'));

    // 2) Await the status from the scanner
    const status = await statusScanner.awaitTransactionStatus(
      txh.hash!,
      500_000
    ); // 1 min timeout

    // 3) If there's a failure reason, the scanner returns { kind: 'RejectedOnInclusion', errors: [...] }
    console.log('Transaction status:', status);
    assert.ok(typeof status === 'object' && status !== null);
    assert.equal(status.kind, 'RejectedOnInclusion');
    assert.ok(Array.isArray(status.errors), 'Expected an array of errors');
    assert.ok(status.errors.length > 0, 'Expected at least one error message');
  });

  it('should reject the promise if the transaction is not found before the timeout', async () => {
    // 1) Use a fake or non-existent transaction ID
    const fakeTxId = 'FAKE_NON_EXISTENT_TX_ID';

    // 2) Expect the promise to reject due to timeout
    await assert.rejects(
      async () => {
        await statusScanner.awaitTransactionStatus(fakeTxId, 2_000);
      },
      (err: Error) =>
        err.message.includes(`timeout`)
    );
  });

  /**
   * Pseudo-code helper: broadcast a transaction that will succeed.
   * Replace with your real logic for building, signing, and sending transactions.
   */
  let counter = 0;
  async function sendSuccessfulTx(
    th: TestHelper<'local'>
  ): Promise<TransactionHandle> {
    const txh = th.tx(
      alice,
      async () => {
        const au = AccountUpdate.createSigned(alice.publicKey);
        au.send({
          to: bob.publicKey,
          amount: 1000,
        });
      },
      {
        name: `alice sends 1000 to bob #${counter++}`,
        printTx: true,
        startingFee: UInt64.from(10e9),
      }
    );

    return txh;
  }

  /**
   * Pseudo-code helper: broadcast a transaction that will fail.
   * Replace with your real logic (e.g. invalid fee, insufficient balance, etc.).
   */
  async function sendFailingTx(
    th: TestHelper<'local'>
  ): Promise<TransactionHandle> {
    const txh = th.tx(
      alice,
      async () => {
        const au = AccountUpdate.createSigned(alice.publicKey);
        au.send({
          to: bob.publicKey,
          amount: 10000e9,
        });
      },
      {
        name: 'alice sends too much to bob',
        printTx: true,
        startingFee: UInt64.from(10e9),
      }
    );

    // For demonstration, we mock a random ID:
    return txh;
  }
});
