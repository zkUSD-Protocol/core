import { ZkUsdEngineContract } from './contracts/zkusd-engine.js';
import { FungibleTokenContract } from '@minatokens/token';
import { VerificationKey } from 'o1js';
import { verificationKeys } from './config/verification-keys.js';
import { validPriceBlockCounts } from './mina/networks.js';
import {
  MinaPriceInput,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  AggregateOraclePricesProof,
} from './proofs/oracle-price-aggregation/index.js';
import { Vault } from './system/vault.js';
import {
  getNetworkKeys,
  NetworkKeyPairs,
  getContractKeys,
} from './config/keys.js';
import {
  ZkusdEngineTransactionArgs,
  ZkusdEngineTransactionType,
} from './system/transaction.js';
import { OracleWhitelist } from './system/oracle.js';
import {
  MintZkUsdEvent,
  BurnZkUsdEvent,
  LiquidateEvent,
  EmergencyStopToggledEvent,
  ValidPriceBlockCountUpdatedEvent,
  AdminUpdatedEvent,
  OracleWhitelistUpdatedEvent,
  DepositCollateralEvent,
  NewVaultEvent,
  RedeemCollateralEvent,
  VaultOwnerUpdatedEvent,
} from './system/events.js';
import {
  CompilationConfig,
  CompilationResults,
  ExecutedTx,
  ExecutorContext,
  compilationConfigIsEqual,
  compileContracts,
} from './transaction/execution.js';
import { ExternalTransactionExecutor } from './transaction/external-executor.js';
import { HttpClientProver } from './provers/httpclientprover.js';
import { MinaNetworkInterface } from './mina/network-interface.js';
import { blockchain } from './mina/networks.js';
import { Mutex } from './utils/mutex.js';
import { TransactionStatus, TxLifecycleStatus } from './transaction/status.js';
import {
  TransactionManager,
  TransactionHandle,
} from './transaction/manager.js';
import { fetchMinaAccount } from './o1js-compat/zckw-fetch.js';
import { proveTransaction } from './transaction/execution.js';
import {
  TxProvingInput,
  TxProvingOutput,
} from './provers/itransactionprover.js';
import { TxProvingTracker } from './transaction/execution.js';
import { FailedBeforeSending } from './transaction/status.js';
import { ZkusdEngineClient } from './client/engine.js';
import { KeyPair } from './types/utility.js';
import {
  TransactionStatusNew,
  TransactionPhase,
  TransactionPhaseStatus,
} from './transaction/lifecycle.js';
import {
  getActiveOracles,
  getOraclePublicKeys,
  getOracles,
  getMaxOraclesCount,
  Oracle,
  OracleConfig,
} from './config/oracles.js';
import { VaultState } from './system/vault.js';

const oracleAggregationVk: VerificationKey = {
  data: verificationKeys.oracleAggregation.data,
  hash: verificationKeys.oracleAggregation.hash,
};

export {
  ZkUsdEngineContract,
  FungibleTokenContract,
  oracleAggregationVk,
  validPriceBlockCounts,
  AggregateOraclePricesProof,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  OracleWhitelist,
  MinaPriceInput,
  getNetworkKeys,
  getContractKeys,
  NetworkKeyPairs,
  ZkusdEngineTransactionArgs,
  ZkusdEngineTransactionType,
  Vault,
  MinaNetworkInterface,
  blockchain,
  KeyPair,
  fetchMinaAccount,
  VaultState,
};

//export events
export {
  VaultOwnerUpdatedEvent,
  NewVaultEvent,
  DepositCollateralEvent,
  RedeemCollateralEvent,
  MintZkUsdEvent,
  BurnZkUsdEvent,
  LiquidateEvent,
  EmergencyStopToggledEvent,
  ValidPriceBlockCountUpdatedEvent,
  AdminUpdatedEvent,
  OracleWhitelistUpdatedEvent,
};

//export transaction services
export {
  TransactionHandle,
  TransactionManager,
  ExternalTransactionExecutor,
  TransactionStatus,
  TxLifecycleStatus,
  CompilationConfig,
  CompilationResults,
  ExecutedTx,
  ExecutorContext,
  compilationConfigIsEqual,
  compileContracts,
  Mutex,
  HttpClientProver,
  TransactionStatusNew,
  TransactionPhase,
  TransactionPhaseStatus,
};

//export transaction prover types
export type {
  TxProvingInput,
  TxProvingOutput,
  TxProvingTracker,
  FailedBeforeSending,
};

//export transaction prover
export { proveTransaction };

export { ZkusdEngineClient as ZKUSDClient };

//export oracle config
export {
  getActiveOracles,
  getOraclePublicKeys,
  getOracles,
  getMaxOraclesCount,
  Oracle,
  OracleConfig,
};
