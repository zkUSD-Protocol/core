import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import fs from 'fs';
import { VerificationKey } from 'o1js';
import path from 'path';

export async function updateVerificationKeys(
  vaultVk: VerificationKey,
  oracleAggregationVk?: VerificationKey
) {
  console.log('Updating verification keys...');

  const keysPath = path.join(
    process.cwd(),
    'src/config/verification-keys.json'
  );
  const keys = {
    vault: vaultVk,
    oracleAggregation: oracleAggregationVk,
  };

  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
  console.log('✅ Verification keys updated successfully');
}
