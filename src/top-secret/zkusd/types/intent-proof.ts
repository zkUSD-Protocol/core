import { BurnIntentProof } from '../programs/intents/burn.js';
import { MintIntentProof } from '../programs/intents/mint.js';
import { TransferIntentProof } from '../programs/intents/transfer.js';
import { RedeemIntentProof } from '../programs/intents/redeem.js';
import { CreateVaultIntentProof } from '../programs/intents/create-vault.js';
import { DepositIntentProof } from '../programs/intents/deposit.js';
import { LiquidateIntentProof } from '../programs/intents/liquidate.js';
import { createHash } from 'crypto';
import { Field, Poseidon } from 'o1js';
import { EpochStateRoots } from '../validator/sequencer-interface.js';

export type IntentProofKind =
  | 'burn'
  | 'mint'
  | 'transfer'
  | 'redeem'
  | 'create-vault'
  | 'deposit'
  | 'liquidate';

export type IntentProof =
  | { kind: 'burn'; proof: BurnIntentProof }
  | { kind: 'mint'; proof: MintIntentProof }
  | { kind: 'transfer'; proof: TransferIntentProof }
  | { kind: 'redeem'; proof: RedeemIntentProof }
  | { kind: 'create-vault'; proof: CreateVaultIntentProof }
  | { kind: 'deposit'; proof: DepositIntentProof }
  | { kind: 'liquidate'; proof: LiquidateIntentProof };

type IntentStateRoots = {
    vaultMapRoot: Field | undefined;
    zkUsdMapRoot: Field | undefined;
};

export function intentStateRootsMatchEpoch(intentStateRoots: IntentStateRoots, epochStateRoots: EpochStateRoots): boolean {
  // if an intent root is present then it must be equal if not then it doesnt matter
  if (intentStateRoots.vaultMapRoot !== undefined) {
    return intentStateRoots.vaultMapRoot.equals(epochStateRoots.vaultMapRoot).toBoolean();
  }
  if (intentStateRoots.zkUsdMapRoot !== undefined) {
    return intentStateRoots.zkUsdMapRoot.equals(epochStateRoots.zkUsdMapRoot).toBoolean();
  }
  return true;
}


export function extractIntentStateCommitment(proof: IntentProof): IntentStateRoots {
  if (isMintIntentProof(proof)) {
    return {
      vaultMapRoot: proof.proof.publicInput.intentVaultMapRoot,
      zkUsdMapRoot: proof.proof.publicInput.intentZkUsdMapRoot,
    };
  }
  if (isTransferIntentProof(proof)) {
    return {
      vaultMapRoot: undefined,
      zkUsdMapRoot: proof.proof.publicInput.intentZkUsdMapRoot,
    };
  }
  if (isRedeemIntentProof(proof)) {
    return {
      vaultMapRoot: proof.proof.publicInput.intentVaultMapRoot,
      zkUsdMapRoot: undefined,
    };
  }
  if (isCreateVaultIntentProof(proof)) {
    return {
      vaultMapRoot: proof.proof.publicInput.vaultMapRoot,
      zkUsdMapRoot: undefined
    };
  }
  if (isDepositIntentProof(proof)) {
    return {
      vaultMapRoot: proof.proof.publicInput.vaultMapRoot,
      zkUsdMapRoot: undefined,
    };
  }
  if (isLiquidateIntentProof(proof)) {
    return {
      vaultMapRoot: proof.proof.publicInput.intentVaultMapRoot,
      zkUsdMapRoot: proof.proof.publicInput.intentZkUsdMapRoot,
    };
  }
  else throw new Error('Unknown intent proof kind');
}

export function hashAnyIntentProof(proof: IntentProof): string {

  const stringified = JSON.stringify(proof.proof.toJSON());

  // sha256
const hash = createHash('sha3-256')
  .update(stringified)
  .digest('hex');
  return hash;
}

// Example: type guard
export function isBurnIntentProof(obj: IntentProof): obj is { kind: 'burn'; proof: BurnIntentProof } {
  return obj.kind === 'burn';
}

export function isMintIntentProof(obj: IntentProof): obj is { kind: 'mint'; proof: MintIntentProof } {
  return obj.kind === 'mint';
}

export function isTransferIntentProof(obj: IntentProof): obj is { kind: 'transfer'; proof: TransferIntentProof } {
  return obj.kind === 'transfer';
}

export function isRedeemIntentProof(obj: IntentProof): obj is { kind: 'redeem'; proof: RedeemIntentProof } {
  return obj.kind === 'redeem';
}

export function isCreateVaultIntentProof(obj: IntentProof): obj is { kind: 'create-vault'; proof: CreateVaultIntentProof } {
  return obj.kind === 'create-vault';
}

export function isDepositIntentProof(obj: IntentProof): obj is { kind: 'deposit'; proof: DepositIntentProof } {
  return obj.kind === 'deposit';
}

export function isLiquidateIntentProof(obj: IntentProof): obj is { kind: 'liquidate'; proof: LiquidateIntentProof } {
  return obj.kind === 'liquidate';
}