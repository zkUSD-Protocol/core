import { ZkUsdVault } from '../contracts/zkusd-vault.js';
import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  vaultVk: VerificationKey;
  oracleAggregationVk: VerificationKey;
}) {
  console.log('Updating verification keys...');

  const keys = {
    vault: {
      data: args.vaultVk.data,
      hash: args.vaultVk.hash.toString(),
    },
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
  };

  // Create the TypeScript content
  const tsContent = `\
import { Field, VerificationKey } from 'o1js';

export const verificationKeys: {
  vault: VerificationKey;
  oracleAggregation: VerificationKey;
} = {
  vault: {
    data: "${keys.vault.data}",
    hash: Field("${keys.vault.hash}")
  },
  oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  }
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
  console.log('✅ Verification keys updated successfully');
}
