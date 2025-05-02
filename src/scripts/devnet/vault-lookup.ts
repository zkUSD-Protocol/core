import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { TransactionManager } from '../../transaction/manager.js';
import { DeploymentService } from '../../deployment/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';
import { LocalTransactionExecutor } from '../../transaction/local-executor.js';
import { OracleWhitelist } from '../../system/oracle.js';
import { getNetworkKeys } from '../../config/keys.js';
import { ITransactionExecutor } from '../../index.node.js';
import { ZkusdEngineClient } from '../../client/engine.js';
import { blockchain } from '../../types/utility.js';

const address = 'B62qmHrr8EFe5GLaGvn1jt2qEpPZnwd2v2yx5guvBGMTMe5QoSyKeRn';
const httpProver = '';

async function lookup() {
  const client = await ZkusdEngineClient.create({
    chain: 'devnet' as blockchain,
    httpProver: 'http://localhost:3337/api/prover',
  });

  const vault = await client.getVaultState(address);

  console.log('collateralAmount', vault.collateralAmount.toString());
  console.log('debtAmount', vault.debtAmount.toString());
}

lookup();
