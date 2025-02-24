import { MinaNetworkInterface } from '../../mina/network-interface.js';
import { TransactionManager } from '../../transaction/manager.js';
import { DeploymentService } from '../../deployment/deployment.js';
import { AccountUpdate, PublicKey } from 'o1js';
import { LocalTransactionExecutor } from '../../transaction/local-executor.js';
import { OracleWhitelist } from '../../system/oracle.js';
import { getNetworkKeys } from '../../config/keys.js';
import { ITransactionExecutor } from '../../index.node.js';

async function updateOracleWhitelist() {
  const MinaChain = await MinaNetworkInterface.initDevnet();
  const executor: ITransactionExecutor = new LocalTransactionExecutor();
  const txMgr = TransactionManager.new(MinaChain, { local: executor });
  const deploymentService = await DeploymentService.create(txMgr);

  const contracts = await deploymentService.deploy();

  const keys = getNetworkKeys('devnet');

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
}

updateOracleWhitelist();
