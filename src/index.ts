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
import {IZkusdGoverningCouncilClient, ZkusdGoverningCouncilClient} from './client/council.js';
import {ZkusdUpdateProtocolState} from "./system/engine-update/protocol-state.js"
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
import { EngineUpdateOperation, EngineUpdateOperationFields, prettyPrintOperation } from './system/engine-update/operation.js';
import { deserializeProof, serializeProof } from './proofs/serialization.js';
import { LocalTransactionExecutor } from './transaction/local-executor.js';
import { ProposalMap } from './system/council/data/proposal-merkle-map.js';
import { CouncilMap } from './system/council/data/council-map.js';
import { Seat } from './system/council/seat.js';
import { ResolutionTree } from './system/council/data/resolution-tree.js';
import { ZkusdProtocolPreconditions } from './system/engine-update/protocol-preconditions.js';
import { MinaChainPreconditions } from './system/engine-update/blockchain-preconditions.js';
import { EngineUpdateVoteProof } from './proofs/engine-update/prove.js';
import { BoolOperation, FieldOperation, UInt64Operation, UInt8Operation } from './system/engine-update/simple-operations.js';
import { CouncilUpdateVoteProof } from './proofs/council-update/prove.js';

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

export type {IZkusdGoverningCouncilClient as IZKUSDGovClient};
export {ZkusdGoverningCouncilClient as ZKUSDGovClient};
export {ProposalMap, CouncilMap, Seat, ResolutionTree}
export {ZkusdProtocolPreconditions, MinaChainPreconditions }
export {EngineUpdateOperation, prettyPrintOperation}
export {EngineUpdateVoteProof}
export {CouncilUpdateVoteProof}
export {BoolOperation, FieldOperation, UInt64Operation, UInt8Operation}

export {ZkusdUpdateProtocolState, EngineUpdateOperationFields}
export {serializeProof, deserializeProof}
export {LocalTransactionExecutor}

//export oracle config
export {
  getActiveOracles,
  getOraclePublicKeys,
  getOracles,
  getMaxOraclesCount,
  Oracle,
  OracleConfig,
};
