import {
  JsonProof,
  verify,
  VerificationKey,
  PublicKey,
  AccountUpdate,
  Transaction,
  PendingTransaction,
  RejectedTransaction,
} from 'o1js';

import {
  VaultTransactionType,
  CreateVaultArgs,
  PriceProofArgs,
  VaultTransactionArgs,
} from '../../types/cloud-worker.js';

import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';

import { NetworkKeyPairs } from '../../config/keys.js';
import { MinaPriceInput } from '../../proofs/oracle-price-aggregation/verify.js';
import {
  TransactionConfig,
  mkVaultTransactionConfigs,
} from './transaction-config.js';
import {
  AggregateOraclePrices,
  AggregateOraclePricesProof,
} from '../../proofs/oracle-price-aggregation/prove.js';
import { ZkUsdEngineContract } from '../../contracts/zkusd-engine.js';
import {
  deserializeTransaction,
  getTransactionParams,
} from './transaction-serialization.js';
import { FungibleTokenContract, fetchMinaAccount } from '@minatokens/token';
import {
  FailedBeforeSending,
  RejectedOnReceive,
  mkStatusFailedBeforeSending,
} from '../../mina/transaction-status.js';
import { TransactionArgs } from '../../mina/transaction-executor.js';

export {
  CompilationConfig,
  CompilationResults,
  ExecutorContext,
  TxLifecycleTracker,
  compileContracts,
  compilationConfigIsEqual,
  executeTransaction,
  proveAndSendTx,
  recreateTransaction,
};

type ZkUsdEngineType = ReturnType<typeof ZkUsdEngineContract>;
type FungibleTokenType = ReturnType<typeof FungibleTokenContract>;

type TxLifecycleTracker = {
  proving: {
    resolver: (proofs: string[]) => void;
    rejector: (error: { status: FailedBeforeSending }) => void;
  };
  sending: {
    resolver: (result: { hash: string; status: 'Pending' }) => void;
    rejector: (error: {
      status: RejectedOnReceive | FailedBeforeSending;
    }) => void;
  };
};

interface ExecutorContext {
  workerId: string;
  chain: MinaNetworkInterface;
  args:  TransactionArgs;
  keys: NetworkKeyPairs;
  compilationResults: CompilationResults;
}

interface CompilationConfig {
  tokenPublicKey: PublicKey;
  enginePublicKey: PublicKey;
}

function compilationConfigIsEqual(
  a: CompilationConfig,
  b: CompilationConfig
): boolean {
  return a.tokenPublicKey
    .equals(b.tokenPublicKey)
    .and(a.enginePublicKey.equals(b.enginePublicKey))
    .toBoolean()
    ? true
    : false;
}

/**
 * Compilation result containing contract instances and verification keys.
 */
interface CompilationResults {
  oracleAggregationVk: VerificationKey;
  engineVk: VerificationKey;
  tokenVk: VerificationKey;
  ZkUsdEngine: ZkUsdEngineType;
  FungibleToken: FungibleTokenType;
  engineInstance: InstanceType<ZkUsdEngineType>;
  tokenInstance: InstanceType<FungibleTokenType>;
  transactionConfigs: { [K in VaultTransactionType]: TransactionConfig<K> };
}

/**
 * Compiles all necessary contracts if needed and returns the results.
 */
async function compileContracts(
  config: CompilationConfig
): Promise<CompilationResults> {
  console.time('Compiling contracts');

  // 1. Compile oracle aggregation proof
  const oracleAggregationVk = new VerificationKey(
    (await AggregateOraclePrices.compile()).verificationKey
  );

  // 2. Create the ZkUsdEngine contract class
  const ZkUsdEngine = ZkUsdEngineContract({
    zkUsdTokenAddress: config.tokenPublicKey,
    minaPriceInputZkProgramVkHash: oracleAggregationVk.hash,
  });

  // 3. Extract FungibleToken class from ZkUsdEngine
  const FungibleToken = ZkUsdEngine.FungibleToken;

  // 4. Compile the FungibleToken contract
  const tokenVk = new VerificationKey(
    (await FungibleToken.compile()).verificationKey
  );

  // 5. Compile the ZkUsdEngine contract
  const engineVk = new VerificationKey(
    (await ZkUsdEngine.compile()).verificationKey
  );

  // 6. Create instances for both contracts
  const engineInstance = new ZkUsdEngine(config.enginePublicKey);
  const tokenInstance = new FungibleToken(config.tokenPublicKey);

  // 7. Generate transaction configurations
  const transactionConfigs = mkVaultTransactionConfigs(engineInstance);

  console.timeEnd('Compiling contracts');

  // Return the compiled results as a new immutable object
  return {
    oracleAggregationVk,
    engineVk,
    tokenVk,
    ZkUsdEngine,
    FungibleToken,
    engineInstance,
    tokenInstance,
    transactionConfigs,
  };
}

/**
 * Converts a JSON proof into a MinaPriceInput instance,
 * verifying it against the aggregator's verification key.
 */
async function getMinaPriceInputFromJsonProof(
  vk: { oracleAggregationVk: VerificationKey },
  jsonProof: JsonProof
): Promise<MinaPriceInput> {
  const proof = (await AggregateOraclePricesProof.fromJSON(
    jsonProof
  )) as AggregateOraclePricesProof;
  const ok = await verify(proof, vk.oracleAggregationVk);
  if (!ok) throw new Error('Proof verification failed');

  return new MinaPriceInput({
    proof,
    verificationKey: vk.oracleAggregationVk,
  });
}

/**
 * Ensures all relevant accounts are fetched with their latest state.
 */
async function fetchLatestAccounts(args: {
  engineInstance: InstanceType<ZkUsdEngineType>;
  engineKey: PublicKey;
  sender: PublicKey;
  vaultAddress: string;
}): Promise<void> {
  const { engineInstance, engineKey, sender, vaultAddress } = args;

  await fetchMinaAccount({
    publicKey: engineKey,
    force: true,
  });
  await fetchMinaAccount({
    publicKey: sender,
    force: true,
  });

  await fetchMinaAccount({
    publicKey: PublicKey.fromBase58(vaultAddress),
    tokenId: engineInstance.deriveTokenId(),
    force: true,
  });
}

async function recreateTransaction<T extends VaultTransactionType>(args: {
  tx: string;
  txArgs: VaultTransactionArgs[T];
  chain: MinaNetworkInterface;
  config: TransactionConfig<T>;
  oracleAggregationVk: VerificationKey;
  engineInstance: InstanceType<ZkUsdEngineType>;
  engineKey: PublicKey;
}): Promise<Transaction<false, false>> {
  const {
    tx,
    config,
    oracleAggregationVk,
    txArgs,
    engineInstance,
    engineKey,
    chain,
  } = args;

  // Parse the transaction details
  const { serializedTx, signedData } = JSON.parse(tx);
  const signedJson = JSON.parse(signedData);
  const { fee, sender, nonce, memo } = getTransactionParams(
    serializedTx,
    signedJson
  );

  // Handle price proof if required
  let minaPriceInput: MinaPriceInput | undefined;
  if (config.requiresPriceProof) {
    const proofArgs = txArgs as PriceProofArgs;
    minaPriceInput = await getMinaPriceInputFromJsonProof(
      { oracleAggregationVk: oracleAggregationVk },
      proofArgs.minaPriceProof
    );
  }

  // Ensure the account states are up to date
  await fetchLatestAccounts({
    engineInstance: engineInstance,
    engineKey: engineKey,
    sender,
    vaultAddress: (txArgs as CreateVaultArgs).vaultAddress,
  });

  // Build the transaction
  const txNew = await chain.transaction(
    { sender, fee, nonce, memo },
    async () => {
      if (config.requiresNewAccounts) {
        AccountUpdate.fundNewAccount(
          sender,
          (txArgs as CreateVaultArgs).newAccounts
        );
      }
      // Build the user-defined transaction instructions
      await config.buildTx(txArgs, minaPriceInput);
    }
  );

  return deserializeTransaction(serializedTx, txNew, signedJson);
}

type ExecutedTx_ =
  | {
      unprovenTx: Transaction<false, false>;
      txStatus: FailedBeforeSending;
    }
  | {
      provenTx: Transaction<true, false>;
      txStatus: FailedBeforeSending;
    }
  | {
      rejectedTx: RejectedTransaction;
      txStatus: RejectedOnReceive;
    }
  | {
      pendingTx: PendingTransaction;
      txStatus: 'Pending';
    };

export type ExecutedTx = ExecutedTx_ & { txId: string };

async function proveAndSendTx(
  txId: string,
  workerId: string,
  tx: Transaction<false, false>,
  executionTracker?: Partial<TxLifecycleTracker>
): Promise<ExecutedTx> {
  let provenTx;
  try {
    console.log('Proving the transaction');
    console.time('proved');
    provenTx = await tx.prove();
    console.timeEnd('proved');
  } catch (err: unknown) {
    executionTracker?.proving?.rejector({
      status: mkStatusFailedBeforeSending(
        txId,
        `{proving the tx by worker: ${workerId}}`,
        err
      ),
    });
    return {
      txId,
      unprovenTx: tx,
      txStatus: mkStatusFailedBeforeSending(
        txId,
        `{proving the tx by worker: ${workerId}}`,
        err
      ),
    };
  }
  // proving was successful
  executionTracker?.proving?.resolver(
    provenTx.proofs.map((p) => JSON.stringify(p?.toJSON()))
  );

  let sentTx;
  try {
    sentTx = await tx.safeSend();
    // unlock the nonce after sending
    switch (sentTx.status) {
      case 'pending': {
        let txStatus: 'Pending' = 'Pending';
        // sending was successful
        executionTracker?.sending?.resolver({
          hash: sentTx.hash,
          status: 'Pending',
        });
        return { txId, pendingTx: sentTx, txStatus };
      }
      case 'rejected': {
        let txStatus: RejectedOnReceive = {
          kind: 'RejectedOnReceive',
          errors: ['error when the tx has been sent', ...sentTx.errors],
        };
        // inclusion rejected
        executionTracker?.sending?.rejector({ status: txStatus });
        return { txId, rejectedTx: sentTx as RejectedTransaction, txStatus };
      }
    }
  } catch (err) {
    // other sending error
    executionTracker?.sending?.rejector({
      status: mkStatusFailedBeforeSending(
        txId,
        `{sending the tx by worker: ${workerId}}`,
        err
      ),
    });
    return {
      txId,
      provenTx,
      txStatus: mkStatusFailedBeforeSending(
        txId,
        `{sending the tx by worker: ${workerId}}`,
        err
      ),
    };
  }
}

async function executeTransaction(
  context: ExecutorContext,
  transaction: string,
  executionTracker?: Partial<TxLifecycleTracker>
): Promise<ExecutedTx> {
  console.log('Executing transaction');

  // Identify the transaction config
  const task = context.args.transactionType; // e.g. 'CREATE_VAULT', 'DEPOSIT', etc.
  if (!context.compilationResults.transactionConfigs) {
    // if proving rejector is defined then reject
    executionTracker?.proving?.rejector({
      status: mkStatusFailedBeforeSending(
        'unknown',
        'proving',
        `Worker ${context.workerId} - transactionConfigs not initialized`
      ),
    });
    throw new Error('transactionConfigs not initialized');
  }

  const config = context.compilationResults.transactionConfigs[
    task
  ] as TransactionConfig<typeof task>;
  if (!config) {
    executionTracker?.proving?.rejector({
      status: mkStatusFailedBeforeSending(
        'unknown',
        'proving',
        `Worker ${context.workerId} - invalid  task parameter`
      ),
    });
    throw new Error(`Unknown task: ${task}`);
  }

  // Parse arguments from context.args
  const vaultArgs = context.args.args;

  // Recreate the transaction
  let tx;
  try {
    tx = await recreateTransaction({
      tx: transaction,
      txArgs: vaultArgs,
      chain: context.chain,
      config: config,
      oracleAggregationVk: context.compilationResults.oracleAggregationVk,
      engineInstance: context.compilationResults.engineInstance,
      engineKey: context.keys.engine.publicKey,
    });
  } catch (err) {
    // if proving rejector is defined then reject
    executionTracker?.proving?.rejector({
      status: mkStatusFailedBeforeSending(
        'unknown',
        'proving',
        `Worker ${context.workerId} - error recreating transaction: ${err}`
      ),
    });
    throw new Error(`Error recreating transaction: ${err}`);
  }

  // prove and send
  return proveAndSendTx(
    vaultArgs.transactionId,
    context.workerId,
    tx,
    executionTracker
  );
}


export function buildArgs(task: VaultTransactionType, argsJson: string): TransactionArgs {
  // Parse the JSON into a plain object.
  const parsed = JSON.parse(argsJson);

  switch (task) {
    case VaultTransactionType.CREATE_VAULT:
      return {
        transactionType: VaultTransactionType.CREATE_VAULT,
        args: parsed as VaultTransactionArgs[VaultTransactionType.CREATE_VAULT],
      };

    case VaultTransactionType.DEPOSIT_COLLATERAL:
      return {
        transactionType: VaultTransactionType.DEPOSIT_COLLATERAL,
        args: parsed as VaultTransactionArgs[VaultTransactionType.DEPOSIT_COLLATERAL],
      };

    case VaultTransactionType.REDEEM_COLLATERAL:
      return {
        transactionType: VaultTransactionType.REDEEM_COLLATERAL,
        args: parsed as VaultTransactionArgs[VaultTransactionType.REDEEM_COLLATERAL],
      };

    case VaultTransactionType.MINT_ZKUSD:
      return {
        transactionType: VaultTransactionType.MINT_ZKUSD,
        args: parsed as VaultTransactionArgs[VaultTransactionType.MINT_ZKUSD],
      };

    case VaultTransactionType.BURN_ZKUSD:
      return {
        transactionType: VaultTransactionType.BURN_ZKUSD,
        args: parsed as VaultTransactionArgs[VaultTransactionType.BURN_ZKUSD],
      };

    case VaultTransactionType.LIQUIDATE:
      return {
        transactionType: VaultTransactionType.LIQUIDATE,
        args: parsed as VaultTransactionArgs[VaultTransactionType.LIQUIDATE],
      };

    default:
      throw new Error(`Unsupported task: ${task}`);
  }
}
