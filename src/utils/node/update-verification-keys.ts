import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  oracleAggregationVk: VerificationKey;
  councilMultiSigProgramVk: VerificationKey;
}) {
  const keys = {
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
    councilMultiSigProgram: {
      data: args.councilMultiSigProgramVk.data,
      hash: args.councilMultiSigProgramVk.hash.toString(),
    },
  };

  // Create the TypeScript content
  const tsContent = `\
import { Field, VerificationKey } from 'o1js';

export const verificationKeys: {
  oracleAggregation: VerificationKey;
  councilMultiSigProgram: VerificationKey;
} = {
oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  },
councilMultiSigProgram:{
    data: "${keys.councilMultiSigProgram.data}",
    hash: Field("${keys.councilMultiSigProgram.hash}")
  },
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
}
