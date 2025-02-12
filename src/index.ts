import { ZkUsdEngineContract } from './contracts/zkusd-engine.js';
import { FungibleTokenContract } from '@minatokens/token';
import { Field, initializeBindings, VerificationKey } from 'o1js';
import { Cloud, zkCloudWorker, initBlockchain } from 'zkcloudworker';
import { verificationKeys } from './config/verification-keys.js';
import { ZkUsdCloudWorker } from './cloud-worker/worker.js';
import { validPriceBlockCount } from './mina/networks.js';
import {
  MinaPriceInput,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  AggregateOraclePricesProof,
} from './proofs/oracle-price-aggregation/index.js';
import { Vault } from './types/vault.js';
import { getNetworkKeys, NetworkKeyPairs } from './config/keys.js';
import {
  VaultTransactionArgs,
  VaultTransactionType,
} from './types/cloud-worker.js';
import { OracleWhitelist } from './types/oracle.js';
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
} from './events.js';
import {
  CompilationConfig,
  CompilationResults,
  ExecutedTx,
  ExecutorContext,
  compilationConfigIsEqual,
  compileContracts,
  executeTransaction,
} from './services/external-tx-processing/transaction-execution.js';
import { MinaNetworkInterface } from './mina/mina-network-interface.js';
import { blockchain } from 'zkcloudworker';
import { Mutex } from './utils/mutex.js';
import {
  TransactionStatus,
  TxLifecycleStatus,
} from './mina/transaction-status.js';

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(`starting worker example version on chain ${cloud.chain}`);
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new ZkUsdCloudWorker(cloud);
}

const oracleAggregationVk: VerificationKey = {
  data: verificationKeys.oracleAggregation.data,
  hash: verificationKeys.oracleAggregation.hash,
};

export {
  ZkUsdEngineContract,
  FungibleTokenContract,
  oracleAggregationVk,
  validPriceBlockCount,
  AggregateOraclePricesProof,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  OracleWhitelist,
  MinaPriceInput,
  getNetworkKeys,
  NetworkKeyPairs,
  VaultTransactionType,
  VaultTransactionArgs,
  Vault,
  MinaNetworkInterface,
  blockchain,
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
  TransactionStatus,
  TxLifecycleStatus,
  CompilationConfig,
  CompilationResults,
  ExecutedTx,
  ExecutorContext,
  compilationConfigIsEqual,
  compileContracts,
  executeTransaction,
  Mutex,
};
