import { MinaNetworkInterface } from '../../mina/mina-network-interface.js';
import { deploy } from '../../services/deployment.js';
import { transaction } from '../../utils/transaction.js';
import { receiveMina } from './receive-mina.js';
import { getNetworkKeys } from '../../config/keys.js';
import { OracleWhitelist } from '../../types.js';
import { fetchMinaAccount } from 'zkcloudworker';

async function main() {
  const MinaChain = await MinaNetworkInterface.initLightnet();
  const deployer = await MinaChain.newAccount();
  const deployedContracts = await deploy(MinaChain, deployer);

  const networkKeys = getNetworkKeys(MinaChain.network.chainId);

  console.log('Contracts deployed');

  console.log('Updating Whitelist');

  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  for (const key of networkKeys.oracles!) {
    whitelist.addresses.push(key.publicKey);
  }

  await fetchMinaAccount({ publicKey: networkKeys.engine.publicKey });

  await transaction(
    deployer,
    async () => {
      await deployedContracts.engine.contract.updateOracleWhitelist(whitelist);
    },
    {
      extraSigners: [networkKeys.protocolAdmin.privateKey],
      printTx: true,
      fee: 1e8,
    }
  );
  console.log('Whitelist updated');

  console.log('Receiving Mina');
  await receiveMina();
}

main();
