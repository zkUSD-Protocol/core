import { FungibleTokenContract } from '@minatokens/token';
import { getNetworkKeys } from '../../config/keys.js';
import { ZkUsdEngineContract } from '../../contracts/zkusd-engine.js';
import { FileSystemCache } from '../../utils/cache.js';
import { ZkUsdVault } from '../../contracts/zkusd-vault.js';
import { ZkUsdPriceTracker } from '../../contracts/zkusd-price-tracker.js';
import { ZkUsdMasterOracle } from '../../contracts/zkusd-master-oracle.js';
import {
  existsSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { Cache } from 'o1js';

async function main() {
  const cache = new FileSystemCache();
  //   const cache = Cache.FileSystem('./cache');
  const networkKeys = getNetworkKeys('lightnet');

  const sourceDir = './cache';
  const destDir = '../ui/public/assets/cache';
  mkdirSync(destDir, { recursive: true });

  const ZkUsdEngine = ZkUsdEngineContract(
    networkKeys.token.publicKey,
    networkKeys.masterOracle.publicKey,
    networkKeys.evenOraclePriceTracker.publicKey,
    networkKeys.oddOraclePriceTracker.publicKey
  );
  const FungibleToken = FungibleTokenContract(ZkUsdEngine);

  await ZkUsdMasterOracle.compile({ cache });
  await ZkUsdPriceTracker.compile({ cache });
  await ZkUsdVault.compile({ cache });
  await ZkUsdEngine.compile({ cache });
  await FungibleToken.compile({ cache });

  // Copy all files from cache to UI directory
  const cacheFiles = readdirSync(sourceDir).filter(
    (file) => !file.endsWith('.header')
  );
  cacheFiles.forEach((file) => {
    copyFileSync(join(sourceDir, file), join(destDir, file));
  });

  // Generate the compiled-files configuration
  const compiledFilesContent = `// Auto-generated file
export const compiledFiles = ${JSON.stringify(
    cacheFiles.map((file) => ({
      name: file,
      type: 'string',
    })),
    null,
    2
  )};
`;

  // Write the configuration file
  const configDir = '../ui/src/lib/utils/cache';
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'compiled-files.ts'), compiledFilesContent);
}

main();
