import { ZkUsdEngineContract } from './contracts/zkusd-engine.js';
import { ZkUsdVault } from './contracts/zkusd-vault.js';
import { FungibleTokenContract } from '@minatokens/token';
import { Field, initializeBindings, VerificationKey } from 'o1js';
import { Cloud, zkCloudWorker, initBlockchain } from 'zkcloudworker';
import { verificationKeys } from './config/verification-keys.js';
import { zkUsdWorker } from './cloud-worker/worker.js';
import { validPriceBlockCount } from './networks.js';
import {
  MinaPriceInput,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  AggregateOraclePricesProof,
} from './proofs/oracle-price-aggregation/index.js';
import {
  OracleWhitelist,
  computeOracleWhitelistHash,
  VaultTransactionType,
  VaultTransactionArgs,
} from './types.js';
import { getNetworkKeys } from './config/keys.js';

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(`starting worker example version on chain ${cloud.chain}`);
  console.log(cloud);
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new zkUsdWorker(cloud);
}

const vaultVk: VerificationKey = {
  data: verificationKeys.vault.data,
  hash: verificationKeys.vault.hash,
};

const oracleAggregationVk: VerificationKey = {
  data: verificationKeys.oracleAggregation.data,
  hash: verificationKeys.oracleAggregation.hash,
};

export {
  ZkUsdEngineContract,
  FungibleTokenContract,
  ZkUsdVault,
  vaultVk,
  oracleAggregationVk,
  validPriceBlockCount,
  AggregateOraclePricesProof,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  OracleWhitelist,
  computeOracleWhitelistHash,
  MinaPriceInput,
  getNetworkKeys,
  VaultTransactionType,
  VaultTransactionArgs,
};
