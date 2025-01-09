import { ZkUsdEngineContract } from './contracts/zkusd-engine.js';
import { ZkUsdVault } from './contracts/zkusd-vault.js';
import { ZkUsdMasterOracle } from './contracts/zkusd-master-oracle.js';
import { ZkUsdPriceTracker } from './contracts/zkusd-price-tracker.js';
import { FungibleTokenContract } from '@minatokens/token';
import { initializeBindings } from 'o1js';
import {
  Cloud,
  zkCloudWorker,
  initBlockchain,
  VerificationData,
  blockchain,
} from 'zkcloudworker';
import packageJson from '../package.json';
import { zkUsdWorker } from './cloud-worker/worker.js';

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(
    `starting worker example version ${
      packageJson.version ?? 'unknown'
    } on chain ${cloud.chain}`
  );
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new zkUsdWorker(cloud);
}

export {
  ZkUsdEngineContract,
  FungibleTokenContract,
  ZkUsdMasterOracle,
  ZkUsdPriceTracker,
  ZkUsdVault,
};
