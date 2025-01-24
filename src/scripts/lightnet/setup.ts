import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';

import { transaction } from '../../utils/transaction.js';
import { receiveMina } from './receive-mina.js';
import { getNetworkKeys } from '../../config/keys.js';
import { OracleWhitelist } from '../../types.js';
import { fetchMinaAccount } from 'zkcloudworker';
import { TransactionManager } from '../../mina/transaction-manager.js';
import { DeploymentService } from '../../services/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';

const RECEIVER_PUBLIC_KEY =
  'B62qmbTQ56amhVUBTH3umviEEnnQhTbKf5EkpyXb62Rzho3T3A1dPYx';
const AMOUNT = 500e9; // 100 Mina

async function main() {
  const MinaChain = await MinaNetworkInterface.initLightnet();
  const txMgr = TransactionManager.new(MinaChain);
  const deploymentService = await DeploymentService.create(txMgr);
  const deployedContracts = await deploymentService.deploy();
  const networkKeys = getNetworkKeys(txMgr.mina.network.chainId);

  console.log('Updating Whitelist');

  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  for (const key of networkKeys.oracles!) {
    whitelist.addresses.push(key.publicKey);
  }

  // Fetch the engine account for the latest nonce
  await txMgr.mina.fetchMinaAccount(networkKeys.engine.publicKey);

  const updateOracleWhitelistTx = await txMgr.tx(
    deploymentService.deployer,
    async () => {
      await deployedContracts.engine.contract.updateOracleWhitelist(whitelist);
    },
    {
      name: 'Update Oracle Whitelist',
      extraSigners: [networkKeys.protocolAdmin.privateKey],
    }
  );

  await Promise.all([updateOracleWhitelistTx.awaitIncluded()]);

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

  await Promise.all([
    updateOracleWhitelistTx.awaitIncluded(),
    receiverAccountTx.awaitIncluded(),
  ]);
}

main();
