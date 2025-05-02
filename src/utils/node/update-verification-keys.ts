import { VerificationKey } from 'o1js';
import fs from 'fs';
import path from 'path';

export async function updateVerificationKeys(args: {
  oracleAggregationVk: VerificationKey;
  EngineUpdateVk: VerificationKey;
  manageCouncilVk: VerificationKey;
}) {
  const keys = {
    oracleAggregation: {
      data: args.oracleAggregationVk.data,
      hash: args.oracleAggregationVk.hash.toString(),
    },
    EngineUpdate: {
      data: args.EngineUpdateVk.data,
      hash: args.EngineUpdateVk.hash.toString(),
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
  EngineUpdate: VerificationKey;
} = {
oracleAggregation: {
    data: "${keys.oracleAggregation.data}",
    hash: Field("${keys.oracleAggregation.hash}")
  },
EngineUpdate:{
    data: "${keys.EngineUpdate.data}",
    hash: Field("${keys.EngineUpdate.hash}")
  },
} as const;
`;

  const keysPath = path.join(process.cwd(), 'src/config/verification-keys.ts');
  fs.writeFileSync(keysPath, tsContent);
}
