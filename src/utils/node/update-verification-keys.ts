import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  oracleAggregationVk: VerificationKey;
}) {
  const keys = {
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
  };

  // Create the TypeScript content
  const tsContent = `\
import { Field, VerificationKey } from 'o1js';

export const verificationKeys: {
  oracleAggregation: VerificationKey;
} = {
  oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  }
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
}
