import { BurnIntentProof } from '../programs/intents/burn.js';
import { MintIntentProof } from '../programs/intents/mint.js';
import { TransferIntentProof } from '../programs/intents/transfer.js';
import { RedeemIntentProof } from '../programs/intents/redeem.js';
import { CreateVaultIntentProof } from '../programs/intents/create-vault.js';
import { DepositIntentProof } from '../programs/intents/deposit.js';
import { LiquidateIntentProof } from '../programs/intents/liquidate.js';
import { IntentStateRoots } from '../optimistic-types.js';
import { createHash } from 'crypto';

export type IntentProofKind =
  | 'burn'
  | 'mint'
  | 'transfer'
  | 'redeem'
  | 'create-vault'
  | 'deposit'
  | 'liquidate';

export type AnyIntentProof =
  | { kind: 'burn'; proof: BurnIntentProof }
  | { kind: 'mint'; proof: MintIntentProof }
  | { kind: 'transfer'; proof: TransferIntentProof }
  | { kind: 'redeem'; proof: RedeemIntentProof }
  | { kind: 'create-vault'; proof: CreateVaultIntentProof }
  | { kind: 'deposit'; proof: DepositIntentProof }
  | { kind: 'liquidate'; proof: LiquidateIntentProof };

export function extractIntentStateCommitment(proof: AnyIntentProof): IntentStateRoots {
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

export function hashAnyIntentProof(proof: AnyIntentProof): string {

  const stringified = JSON.stringify(proof.proof.toJSON());

  // sha256
const hash = createHash('sha3-256')
  .update(stringified)
  .digest('hex');
  return hash;
}

// Example: type guard
export function isBurnIntentProof(obj: AnyIntentProof): obj is { kind: 'burn'; proof: BurnIntentProof } {
  return obj.kind === 'burn';
}

export function isMintIntentProof(obj: AnyIntentProof): obj is { kind: 'mint'; proof: MintIntentProof } {
  return obj.kind === 'mint';
}

export function isTransferIntentProof(obj: AnyIntentProof): obj is { kind: 'transfer'; proof: TransferIntentProof } {
  return obj.kind === 'transfer';
}

export function isRedeemIntentProof(obj: AnyIntentProof): obj is { kind: 'redeem'; proof: RedeemIntentProof } {
  return obj.kind === 'redeem';
}

export function isCreateVaultIntentProof(obj: AnyIntentProof): obj is { kind: 'create-vault'; proof: CreateVaultIntentProof } {
  return obj.kind === 'create-vault';
}

export function isDepositIntentProof(obj: AnyIntentProof): obj is { kind: 'deposit'; proof: DepositIntentProof } {
  return obj.kind === 'deposit';
}

export function isLiquidateIntentProof(obj: AnyIntentProof): obj is { kind: 'liquidate'; proof: LiquidateIntentProof } {
  return obj.kind === 'liquidate';
}