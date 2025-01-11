import { MinaChain } from '../../mina.js';
import { deploy } from '../../deploy.js';

async function main() {
  await MinaChain.initLightnet();
  const deployer = await MinaChain.newAccount();
  await deploy(MinaChain, deployer);
}

main();
