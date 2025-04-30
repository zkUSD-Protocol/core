import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  oracleAggregationVk: VerificationKey;
  governanceUpdateVk: VerificationKey;
  manageCouncilVk: VerificationKey;
}) {
  const keys = {
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
    governanceUpdate: {
      data: args.governanceUpdateVk.data,
      hash: args.governanceUpdateVk.hash.toString(),
    },
    manageCouncil: {
      data: args.manageCouncilVk.data,
      hash: args.manageCouncilVk.hash.toString(),
    },
  };

  // Create the TypeScript content
  const tsContent = `\
import { Field, VerificationKey } from 'o1js';

export const verificationKeys: {
  oracleAggregation: VerificationKey;
  governanceUpdate: VerificationKey;
} = {
oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  },
governanceUpdate:{
    data: "${keys.governanceUpdate.data}",
    hash: Field("${keys.governanceUpdate.hash}")
  },
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
}
