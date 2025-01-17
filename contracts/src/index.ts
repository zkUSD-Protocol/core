import { ZkUsdEngineContract } from './contracts/zkusd-engine.js';
import { ZkUsdVault } from './contracts/zkusd-vault.js';
import { FungibleTokenContract } from '@minatokens/token';
import { Field, initializeBindings, VerificationKey } from 'o1js';
import { Cloud, zkCloudWorker, initBlockchain } from 'zkcloudworker';
import verificationKeys from './config/verification-keys.json';
import { zkUsdWorker } from './cloud-worker/worker.js';
import { MinaNetwork } from './networks.js';

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(`starting worker example version on chain ${cloud.chain}`);
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new zkUsdWorker(cloud);
}

const vaultKey: VerificationKey = {
  data: verificationKeys.vault.data,
  hash: Field(verificationKeys.vault.hash),
};

export { ZkUsdEngineContract, FungibleTokenContract, ZkUsdVault, vaultKey };
