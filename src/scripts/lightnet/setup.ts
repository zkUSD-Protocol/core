import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { TransactionManager } from '../../transaction/manager.js';
import { DeploymentService } from '../../deployment/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';
import { LocalTransactionExecutor } from '../../transaction/local-executor.js';
import { getNetworkKeys } from '../../config/keys.js';
import { ITransactionExecutor } from '../../index.node.js';

const AMOUNT = 500e9; // 100 Mina

async function main() {
  const MinaChain = await MinaNetworkInterface.initLightnet();
  const executor: ITransactionExecutor = new LocalTransactionExecutor();
  const txMgr = TransactionManager.new(MinaChain, { local: executor });
  const deploymentService = await DeploymentService.create(txMgr);
  await deploymentService.deploy();
  await fundCouncilMembers(deploymentService, txMgr);
}

async function fundCouncilMembers(
  deploymentService: DeploymentService,
  txMgr: TransactionManager<any>
) {
  const chain = txMgr.mina.network.chainId;

  const councilKeys: PublicKey[] =
    getNetworkKeys(chain).council?.map((keypair) => keypair.publicKey) ?? [];

    if (!councilKeys) {
      console.warn(`No council keys found for ${chain}`);
      return;
    }

  councilKeys.forEach(async (key, index) => {
    const receiverAccount = await txMgr.mina.fetchMinaAccount(key);

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
          to: key,
          amount: AMOUNT,
        });
      },
      {
        name: `Funding Council Member ${index}`,
      }
    );

    await receiverAccountTx.awaitIncluded();
    console.log(`Funded council member ${index} with ${AMOUNT} to ${key.toBase58()}`);
  });
}

main();
