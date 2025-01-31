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

export {
  CompilationResults,
  ExecutorContext,
  compileContracts,
  executeTransaction,
  proveAndSendTx,
  recreateTransaction,
};

type ZkUsdEngineType = ReturnType<typeof ZkUsdEngineContract>;
type FungibleTokenType = ReturnType<typeof FungibleTokenContract>;

interface ExecutorContext {
  workerId: string;
  chain: MinaNetworkInterface;
  task: VaultTransactionType;
  args: string;
  keys: NetworkKeyPairs;
  compilationResults: CompilationResults;
}

interface CompilationConfig {
  tokenPublicKey: PublicKey;
  enginePublicKey: PublicKey;
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
  tx: Transaction<false, false>
): Promise<ExecutedTx> {
  let provenTx;
  try {
    console.log('Proving the transaction');
    console.time('proved');
    provenTx = await tx.prove();
    console.timeEnd('proved');
  } catch (err: unknown) {
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

  let sentTx;
  try {
    sentTx = await tx.safeSend();
    // unlock the nonce after sending
    switch (sentTx.status) {
      case 'pending': {
        let txStatus: 'Pending' = 'Pending';
        return { txId, pendingTx: sentTx, txStatus };
      }
      case 'rejected': {
        let txStatus: RejectedOnReceive = {
          kind: 'RejectedOnReceive',
          errors: ['error when the tx has been sent', ...sentTx.errors],
        };
        return { txId, rejectedTx: sentTx as RejectedTransaction, txStatus };
      }
    }
  } catch (err) {
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
  transaction: string
): Promise<ExecutedTx> {
  console.log('Executing transaction');

  // Identify the transaction config
  const task = context.task; // e.g. 'CREATE_VAULT', 'DEPOSIT', etc.
  if (!context.compilationResults.transactionConfigs)
    throw new Error('transactionConfigs not initialized');

  const config = context.compilationResults.transactionConfigs[
    task
  ] as TransactionConfig<typeof task>;
  if (!config) throw new Error(`Unknown task: ${task}`);

  // Parse arguments from context.args
  const vaultArgs = JSON.parse(
    context.args
  ) as VaultTransactionArgs[typeof task];

  // Recreate the transaction
  const tx = await recreateTransaction({
    tx: transaction,
    txArgs: vaultArgs,
    chain: context.chain,
    config: config,
    oracleAggregationVk: context.compilationResults.oracleAggregationVk,
    engineInstance: context.compilationResults.engineInstance,
    engineKey: context.keys.engine.publicKey,
  });

  // prove and send
  return proveAndSendTx(vaultArgs.transactionId, context.workerId, tx);
}
