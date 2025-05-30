import { BurnIntentProof } from '../programs/intents/burn.js';
import { MintIntentOutput, MintIntentProof } from '../programs/intents/mint.js';
import {
  TransferIntentOutput,
  TransferIntentProof,
} from '../programs/intents/transfer.js';
import {
  RedeemIntentOutput,
  RedeemIntentProof,
} from '../programs/intents/redeem.js';
import {
  CreateVaultIntentOutput,
  CreateVaultIntentProof,
} from '../programs/intents/create-vault.js';
import {
  DepositIntentOutput,
  DepositIntentProof,
} from '../programs/intents/deposit.js';
import {
  LiquidateIntentOutput,
  LiquidateIntentProof,
} from '../programs/intents/liquidate.js';
import { createHash } from 'crypto';
import { Field, Poseidon } from 'o1js';
import { StateRoots, SystemParams } from '../validator/block-state.js';
import { IntentMapOperation } from '../validator/map-operation.js';
import { Vault } from '../data/vault.js';
import { Note } from '../data/note.js';

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

export function intentStateRootsMatchBlock(
  intentStateRoots: IntentStateRoots,
  blockStateRoots: StateRoots
): boolean {
  // if an intent root is present then it must be equal if not then it doesnt matter
  if (intentStateRoots.vaultMapRoot !== undefined) {
    return intentStateRoots.vaultMapRoot
      .equals(blockStateRoots.vaultMapRoot)
      .toBoolean();
  }
  if (intentStateRoots.zkUsdMapRoot !== undefined) {
    return intentStateRoots.zkUsdMapRoot
      .equals(blockStateRoots.zkUsdMapRoot)
      .toBoolean();
  }
  return true;
}

export function extractIntentMapOperations(
  intentProof: IntentProof,
  systemParams: SystemParams
): IntentMapOperation[] {
  if (isMintIntentProof(intentProof)) {
    const proof = intentProof.proof as MintIntentProof;
    const publicOutput: MintIntentOutput = proof.publicOutput;
    const liquidationBonusRatio = systemParams.liquidationBonusRatio;
    const intentMapOperations = IntentMapOperation.updateVaultMap(
      publicOutput.vaultUpdate.vaultAddress,
      Vault({
        collateralRatio: systemParams.collateralRatio,
        liquidationBonusRatio,
      })
        .fromState(publicOutput.vaultUpdate.vaultState)
        .pack()
    );

    return [intentMapOperations];
  }
  if (isTransferIntentProof(intentProof)) {
    const proof = intentProof.proof as TransferIntentProof;
    const publicOutput: TransferIntentOutput = proof.publicOutput;
    const nullifiers = publicOutput.nullifiers;
    const outputNoteCommitments = publicOutput.outputNoteCommitments;

    const operations: IntentMapOperation[] = [];
    nullifiers.nullifiers.forEach((nullifier) => {
      if (nullifier.isDummy.not().toBoolean()) {
        operations.push(
          IntentMapOperation.setVaultMap(nullifier.nullifier, Note.included())
        );
      }
    });
    outputNoteCommitments.commitments.forEach((outputNoteCommitment) => {
      if (outputNoteCommitment.isDummy.not().toBoolean()) {
        operations.push(
          IntentMapOperation.setZkusdMap(
            outputNoteCommitment.commitment,
            Note.included()
          )
        );
      }
    });

    return operations;
  }

  if (isRedeemIntentProof(intentProof)) {
    const proof = intentProof.proof as RedeemIntentProof;
    const publicOutput: RedeemIntentOutput = proof.publicOutput;
    const liquidationBonusRatio = systemParams.liquidationBonusRatio;
    const updateVault = IntentMapOperation.updateVaultMap(
      publicOutput.vaultUpdate.vaultAddress,
      Vault({
        collateralRatio: systemParams.collateralRatio,
        liquidationBonusRatio,
      })
        .fromState(publicOutput.vaultUpdate.vaultState)
        .pack()
    );

    return [updateVault];
  }
  if (isCreateVaultIntentProof(intentProof)) {
    const proof = intentProof.proof as CreateVaultIntentProof;
    const publicOutput: CreateVaultIntentOutput = proof.publicOutput;
    const insertVault = IntentMapOperation.insertVaultMap(
      publicOutput.vaultKey.key,
      Vault({
        collateralRatio: systemParams.collateralRatio,
        liquidationBonusRatio: systemParams.liquidationBonusRatio,
      })
        .new(publicOutput.vaultType)
        .pack()
    );

    return [insertVault];
  }
  if (isDepositIntentProof(intentProof)) {
    const proof = intentProof.proof as DepositIntentProof;
    const publicOutput: DepositIntentOutput = proof.publicOutput;
    const updateVault = IntentMapOperation.updateVaultMap(
      publicOutput.vaultKey.key,
      publicOutput.vaultPack
    );

    return [updateVault];
  }
  if (isLiquidateIntentProof(intentProof)) {
    const proof = intentProof.proof as LiquidateIntentProof;
    const publicOutput: LiquidateIntentOutput = proof.publicOutput;
    const vaultUpdate = IntentMapOperation.updateVaultMap(
      publicOutput.vaultUpdate.vaultAddress,
      Vault({
        collateralRatio: systemParams.collateralRatio,
        liquidationBonusRatio: systemParams.liquidationBonusRatio,
      })
        .fromState(publicOutput.vaultUpdate.vaultState)
        .pack()
    );
    const outputNoteCommitment = publicOutput.outputNoteCommitment;
    const zkusdUpdate = IntentMapOperation.insertZkusdMap(
      outputNoteCommitment.commitment,
      Note.included()
    );

    return [vaultUpdate, zkusdUpdate];
  }
  throw new Error('Unknown intent proof kind');
}

export function extractIntentStateCommitment(
  proof: IntentProof
): IntentStateRoots {
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
      zkUsdMapRoot: undefined,
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
  } else throw new Error('Unknown intent proof kind');
}

export function hashAnyIntentProof(proof: IntentProof): string {
  const stringified = JSON.stringify(proof.proof.toJSON());

  // sha256
  const hash = createHash('sha3-256').update(stringified).digest('hex');
  return hash;
}

// Example: type guard
export function isBurnIntentProof(
  obj: IntentProof
): obj is { kind: 'burn'; proof: BurnIntentProof } {
  return obj.kind === 'burn';
}

export function isMintIntentProof(
  obj: IntentProof
): obj is { kind: 'mint'; proof: MintIntentProof } {
  return obj.kind === 'mint';
}

export function isTransferIntentProof(
  obj: IntentProof
): obj is { kind: 'transfer'; proof: TransferIntentProof } {
  return obj.kind === 'transfer';
}

export function isRedeemIntentProof(
  obj: IntentProof
): obj is { kind: 'redeem'; proof: RedeemIntentProof } {
  return obj.kind === 'redeem';
}

export function isCreateVaultIntentProof(
  obj: IntentProof
): obj is { kind: 'create-vault'; proof: CreateVaultIntentProof } {
  return obj.kind === 'create-vault';
}

export function isDepositIntentProof(
  obj: IntentProof
): obj is { kind: 'deposit'; proof: DepositIntentProof } {
  return obj.kind === 'deposit';
}

export function isLiquidateIntentProof(
  obj: IntentProof
): obj is { kind: 'liquidate'; proof: LiquidateIntentProof } {
  return obj.kind === 'liquidate';
}
