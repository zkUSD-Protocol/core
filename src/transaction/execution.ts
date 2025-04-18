import {
  JsonProof,
  verify,
  VerificationKey,
  PublicKey,
  AccountUpdate,
  Transaction,
  PendingTransaction,
  RejectedTransaction,
  Cache,
} from 'o1js';

import {
  ZkusdEngineTransactionType,
  CreateVaultArgs,
  PriceProofArgs,
  ZkusdEngineTransactionArgs,
  TransactionArgs,
} from '../system/transaction.js';

import { MinaNetworkInterface } from '../mina/network-interface.js';
import { MinaPriceInput } from '../proofs/oracle-price-aggregation/verify.js';
import {
  TransactionConfig,
  mkZkusdTransactionConfigs,
} from '../system/transaction-config.js';
import {
  AggregateOraclePrices,
  AggregateOraclePricesProof,
} from '../proofs/oracle-price-aggregation/prove.js';
import { ZkUsdEngineContract } from '../contracts/zkusd-engine.js';
import {
  deserializeTransaction,
  getTransactionParams,
  serializeTransaction,
} from '../utils/transaction-serialization.js';
import { FungibleTokenContract } from '@minatokens/token';
import {
  FailedBeforeSending,
  RejectedOnReceive,
  mkStatusFailedBeforeSending,
} from './status.js';
import { ZkusdGoverningCouncilContract } from '../contracts/zkusd-governing-council.js';

export {
  CompilationConfig,
  CompilationResults,
  ExecutorContext,
  TxProvingTracker,
  compileContracts,
  compilationConfigIsEqual,
  zkUsdTransaction,
  proveTransaction,
};

type ZkUsdEngineType = ReturnType<typeof ZkUsdEngineContract>;
type FungibleTokenType = ReturnType<typeof FungibleTokenContract>;

type TxProvingTracker = {
  proving: {
    resolver: (serializedTx: string) => void;
    rejector: (error: { status: FailedBeforeSending }) => void;
  };
};

interface ExecutorContext {
  workerId: string;
  chain: MinaNetworkInterface;
  args: TransactionArgs;
  compilationResults: CompilationResults;
}

interface CompilationConfig {
  tokenPublicKey: PublicKey;
  enginePublicKey: PublicKey;
  governmentPublicKey: PublicKey;
  cache?: Cache;
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
  transactionConfigs: {
    [K in ZkusdEngineTransactionType]: TransactionConfig<K>;
  };
}

/**
 * Compiles all necessary contracts if needed and returns the results.
 */
async function compileContracts(
  config: CompilationConfig
): Promise<CompilationResults> {
  console.time('Compiling contracts');

  // Only include cache in compile options if it's provided
  const compileOptions = config.cache ? { cache: config.cache } : {};

  // 1. Compile oracle aggregation proof
  const oracleAggregationVk = new VerificationKey(
    (await AggregateOraclePrices.compile(compileOptions)).verificationKey
  );

  // 2. Create the ZkUsdEngine contract class
  const ZkUsdEngine = ZkUsdEngineContract({
    zkUsdTokenAddress: config.tokenPublicKey,
    minaPriceInputZkProgramVkHash: oracleAggregationVk.hash,
    zkUsdGovernmentAddress: config.governmentPublicKey,
    GovernmentClass: ZkusdGoverningCouncilContract
  });

  // 3. Extract FungibleToken class from ZkUsdEngine
  const FungibleToken = ZkUsdEngine.FungibleToken;

  // 4. Compile the FungibleToken contract
  const tokenVk = new VerificationKey(
    (await FungibleToken.compile(compileOptions)).verificationKey
  );

  // 5. Compile the ZkUsdEngine contract
  const engineVk = new VerificationKey(
    (await ZkUsdEngine.compile(compileOptions)).verificationKey
  );

  // 6. Create instances for both contracts
  const engineInstance = new ZkUsdEngine(config.enginePublicKey);
  const tokenInstance = new FungibleToken(config.tokenPublicKey);

  // 7. Generate transaction configurations
  const transactionConfigs = mkZkusdTransactionConfigs(engineInstance);

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

async function recreateTransaction<T extends ZkusdEngineTransactionType>(args: {
  tx: string;
  txArgs: ZkusdEngineTransactionArgs[T];
  chain: MinaNetworkInterface;
  config: TransactionConfig<T>;
  oracleAggregationVk: VerificationKey;
  engineInstance: InstanceType<ZkUsdEngineType>;
}): Promise<Transaction<false, false>> {
  const { tx, config, oracleAggregationVk, txArgs, chain } = args;

  // Parse the transaction details
  const { serializedTx, signedData } = JSON.parse(tx);
  const { fee, sender, nonce, memo } = getTransactionParams(
    serializedTx,
    signedData
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

  // fetch all the required accounts
  chain.forceFetchAllTxPartiesJson(signedData);

  // Build the transaction
  const txNew = await chain.transaction(
    { sender, fee, nonce, memo },
    async () => {
      if (config.requiresNewAccounts) {
        if (!('newAccounts' in txArgs)) {
          throw new Error('New accounts are required');
        }
        AccountUpdate.fundNewAccount(sender, txArgs.newAccounts);
      }
      // Build the user-defined transaction instructions
      await config.buildTx(txArgs, minaPriceInput);
    }
  );

  return deserializeTransaction(serializedTx, txNew, signedData);
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

async function proveTransaction(
  context: ExecutorContext,
  transaction: string,
  executionTracker: TxProvingTracker
): Promise<void> {
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
  return proveTx(
    vaultArgs.transactionId,
    context.workerId,
    tx,
    executionTracker
  );
}

export function buildArgs(
  task: ZkusdEngineTransactionType,
  argsJson: string
): TransactionArgs {
  // Parse the JSON into a plain object.
  const parsed = JSON.parse(argsJson);

  switch (task) {
    case ZkusdEngineTransactionType.CREATE_VAULT:
      return {
        transactionType: ZkusdEngineTransactionType.CREATE_VAULT,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.CREATE_VAULT],
      };

    case ZkusdEngineTransactionType.DEPOSIT_COLLATERAL:
      return {
        transactionType: ZkusdEngineTransactionType.DEPOSIT_COLLATERAL,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.DEPOSIT_COLLATERAL],
      };

    case ZkusdEngineTransactionType.REDEEM_COLLATERAL:
      return {
        transactionType: ZkusdEngineTransactionType.REDEEM_COLLATERAL,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.REDEEM_COLLATERAL],
      };

    case ZkusdEngineTransactionType.MINT_ZKUSD:
      return {
        transactionType: ZkusdEngineTransactionType.MINT_ZKUSD,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.MINT_ZKUSD],
      };

    case ZkusdEngineTransactionType.BURN_ZKUSD:
      return {
        transactionType: ZkusdEngineTransactionType.BURN_ZKUSD,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.BURN_ZKUSD],
      };

    case ZkusdEngineTransactionType.LIQUIDATE:
      return {
        transactionType: ZkusdEngineTransactionType.LIQUIDATE,
        args: parsed as ZkusdEngineTransactionArgs[ZkusdEngineTransactionType.LIQUIDATE],
      };

    default:
      throw new Error(`Unsupported task: ${task}`);
  }
}

export type MinaPriceInputArgs<T> = T extends ZkusdEngineTransactionType
  ? MinaPriceInput
  : undefined;

const zkUsdTransaction = async <T extends ZkusdEngineTransactionType>(args: {
  kind: T;
  sender: PublicKey;
  txArgs: ZkusdEngineTransactionArgs[T];
  engine: InstanceType<ZkUsdEngineType>;
  accountsUpToDate: boolean; // just to inform the function user
  minaPriceInput: MinaPriceInput | undefined;
}) => {
  const { kind, txArgs, engine, accountsUpToDate, sender, minaPriceInput } =
    args;
  if (!accountsUpToDate) {
    throw new Error('Accounts are not up to date');
  }

  const callback = async () => {
    const config = mkZkusdTransactionConfigs(engine)[kind];
    if (config.requiresNewAccounts) {
      if (!('newAccounts' in txArgs)) {
        throw new Error('New accounts are required');
      }
      AccountUpdate.fundNewAccount(
        sender,
        (txArgs as CreateVaultArgs).newAccounts
      );
    }
    // Build the user-defined transaction instructions
    await config.buildTx(txArgs, minaPriceInput);
  };

  return { callback };
};

async function proveTx(
  txId: string,
  workerId: string,
  tx: Transaction<false, false>,
  executionTracker: TxProvingTracker
): Promise<void> {
  let provenTx;
  try {
    console.log(`${txId} - Proving ...`);
    console.time(`${txId} - Proved.`);
    provenTx = await tx.prove();
    console.timeEnd(`${txId} - Proved.`);
  } catch (err: unknown) {
    executionTracker?.proving?.rejector({
      status: mkStatusFailedBeforeSending(
        txId,
        `{proving the tx by worker: ${workerId}}`,
        err
      ),
    });
    return;
  }
  // proving was successful
  executionTracker?.proving?.resolver(serializeTransaction(provenTx));
  return;
}
