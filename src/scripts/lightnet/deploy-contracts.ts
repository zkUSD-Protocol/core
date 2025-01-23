import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';
import { deploy } from '../../services/deployment.js';
import { transaction } from '../../utils/transaction.js';
import { receiveMina } from './receive-mina.js';
import { getNetworkKeys } from '../../config/keys.js';
import { OracleWhitelist } from '../../types.js';
import { fetchMinaAccount } from 'zkcloudworker';
import { TransactionManager } from '../../mina/transaction-manager.js';

async function main() {
  const MinaChain = await MinaNetworkInterface.initLightnet();
  const txMgr = TransactionManager.new(MinaChain);
  const deployer = await txMgr.mina.newAccount();
  const deployedContracts = await deploy(txMgr, deployer);

  const networkKeys = getNetworkKeys(txMgr.mina.network.chainId);

  console.log('Contracts deployed');

  console.log('Updating Whitelist');

  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  for (const key of networkKeys.oracles!) {
    whitelist.addresses.push(key.publicKey);
  }

  const txHandle = await txMgr.tx(
    deployer,
    async () => {
      await deployedContracts.engine.contract.updateOracleWhitelist(whitelist);
    },
    {
      name: 'Update Oracle Whitelist',
      extraSigners: [networkKeys.protocolAdmin.privateKey],
    }
  );

  await txHandle.awaitIncluded();

  console.log('Whitelist updated');

  console.log('Receiving Mina');
  await receiveMina();
}

main();
