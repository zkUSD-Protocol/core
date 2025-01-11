import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import fs from 'fs';
import { VerificationKey } from 'o1js';
import path from 'path';

export async function updateVerificationKeys(vk: VerificationKey) {
  console.log('Compiling contracts to update verification keys...');

  const keysPath = path.join(
    process.cwd(),
    'src/config/verification-keys.json'
  );
  const keys = {
    vault: vk,
  };

  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
  console.log('✅ Verification keys updated successfully');
}
