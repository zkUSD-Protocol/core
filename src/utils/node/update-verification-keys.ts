import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  oracleAggregationVk: VerificationKey;
  adminSigProgramVk: VerificationKey;
}) {
  const keys = {
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
    adminSigProgram: {
      data: args.adminSigProgramVk.data,
      hash: args.adminSigProgramVk.hash.toString(),
    },
  };

  // Create the TypeScript content
  const tsContent = `\
import { Field, VerificationKey } from 'o1js';

export const verificationKeys: {
  oracleAggregation: VerificationKey;
  adminSigProgram: VerificationKey;
} = {
oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  },
adminSigProgram: {
    data: "${keys.adminSigProgram.data}",
    hash: Field("${keys.adminSigProgram.hash}")
  },
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
}
