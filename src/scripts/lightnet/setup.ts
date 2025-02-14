import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { TransactionManager } from '../../transaction/manager.js';
import { DeploymentService } from '../../deployment/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';
import { LocalTransactionExecutor } from '../../transaction/local-executor.js';
import { OracleWhitelist } from '../../system/oracle.js';
import { getNetworkKeys } from '../../config/keys.js';
import { ITransactionExecutor } from '../../index.node.js';

const RECEIVER_PUBLIC_KEY =
  'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx';
const AMOUNT = 500e9; // 100 Mina

async function main() {
  const MinaChain = await MinaNetworkInterface.initLightnet();
  const executor: ITransactionExecutor = new LocalTransactionExecutor();
  const txMgr = TransactionManager.new(MinaChain, { local: executor });
  const deploymentService = await DeploymentService.create(txMgr);

  const keys = getNetworkKeys('lightnet');

  const contracts = await deploymentService.deploy();

  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  //Update the oracle whitelist
  for (let i = 0; i < OracleWhitelist.MAX_PARTICIPANTS; i++) {
    whitelist.addresses[i] = keys.oracles![i].publicKey;
  }

  const oracleWhitelistHash = OracleWhitelist.hash(whitelist);

  const engineOracleWhitelistHash =
    await contracts.engine.contract.oracleWhitelistHash.fetch();

  if (
    !!engineOracleWhitelistHash &&
    engineOracleWhitelistHash.toBigInt() == oracleWhitelistHash.toBigInt()
  ) {
    console.log('Oracle whitelist already set');
  } else {
    console.log('Updating oracle whitelist');

    const txHandle = await txMgr.tx(
      deploymentService.deployer,
      async () => {
        await contracts.engine.contract.updateOracleWhitelist(whitelist);
      },
      {
        name: 'Updating oracle whitelist',
        extraSigners: [keys.protocolAdmin.privateKey],
      }
    );
    await txHandle.awaitIncluded();
  }

  const receiverAccount =
    await txMgr.mina.fetchMinaAccount(RECEIVER_PUBLIC_KEY);

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
