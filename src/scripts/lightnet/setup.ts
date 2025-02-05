import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';
import { TransactionManager } from '../../mina/transaction-manager.js';
import { DeploymentService } from '../../services/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';
import { LocalTransactionExecutor } from '../../mina/local-transaction-executor.js';

const RECEIVER_PUBLIC_KEY =
  'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx';
const AMOUNT = 500e9; // 100 Mina

async function main() {  const MinaChain = await MinaNetworkInterface.initLightnet();
  const executor = new LocalTransactionExecutor();
  const txMgr = TransactionManager.new(MinaChain, executor);
  const deploymentService = await DeploymentService.create(txMgr);
  await deploymentService.deploy();

  const receiverAccount = await txMgr.mina.fetchMinaAccount(
    RECEIVER_PUBLIC_KEY
  );

  const receiverAccountTx = await txMgr.tx(
    deploymentService.deployer,
    async () => {
      if (!receiverAccount) {
        AccountUpdate.fundNewAccount(deploymentService.deployer.publicKey, 1);
      }
      const au = AccountUpdate.createSigned(
        deploymentService.deployer.publicKey
      );
      au.send({
        to: PublicKey.fromBase58(RECEIVER_PUBLIC_KEY),
        amount: AMOUNT,
      });
    },
    {
      name: 'Fund Receiver Account',
    }
  );

  await receiverAccountTx.awaitIncluded();
}

main();
