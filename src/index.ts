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

import { getNetworkKeys } from './config/keys.js';
import {
  VaultTransactionArgs,
  VaultTransactionType,
} from './types/cloud-worker.js';
import { OracleWhitelist } from './types/oracle.js';

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(`starting worker example version on chain ${cloud.chain}`);
  console.log(cloud);
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new ZkUsdCloudWorker(cloud);
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
  vaultVk,
  oracleAggregationVk,
  validPriceBlockCount,
  AggregateOraclePricesProof,
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  OracleWhitelist,
  MinaPriceInput,
  getNetworkKeys,
  VaultTransactionType,
  VaultTransactionArgs,
};
