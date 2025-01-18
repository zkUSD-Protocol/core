import { MinaChain } from '../../mina.js';
import { deploy } from '../../deploy.js';
import { transaction } from '../../utils/transaction.js';
import { receiveMina } from './receive-mina.js';
import { getNetworkKeys } from '../../config/keys.js';
import { OracleWhitelist } from '../../types.js';
import { fee } from 'zkcloudworker';
import { fetchAccount } from 'o1js';

async function main() {
  await MinaChain.initLightnet();
  const deployer = await MinaChain.newAccount();
  const deployedContracts = await deploy(MinaChain, deployer);

  const networkKeys = getNetworkKeys(MinaChain.network().chainId);

  console.log('Contracts deployed');

  console.log('Updating Whitelist');

  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  for (const key of networkKeys.oracles!) {
    whitelist.addresses.push(key.publicKey);
  }

  await fetchAccount({ publicKey: networkKeys.engine.publicKey });

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
