import { createHash } from 'crypto';
import { Field, JsonProof } from 'o1js';

import {
  BurnIntentProof,
  MintIntentProof,
  TransferIntentProof,
  RedeemIntentProof,
  CreateVaultIntentProof,
  DepositIntentProof,
  LiquidateIntentProof,
} from '../programs/intents/index.js';

import { SystemParams, StateRoots } from '../validator/block-state.js';
import { IntentMapOperation } from '../validator/map-operation.js';
import { Vault } from '../data/vault.js';
import { Note } from '../data/note.js';

/* ─────────────────────────────────────────────────────────────── */
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

export type JsonIntentProof = {
  kind: IntentProofKind;
  proof: JsonProof;
};

export interface IntentStateRoots {
  vaultMapRoot?: Field;
  zkUsdMapRoot?: Field;
}

/* ------------------------------------------------------------------
 *  Function-style Handler Definition
 * ----------------------------------------------------------------- */
interface HandlerResult {
  operations: IntentMapOperation[];
  roots: IntentStateRoots;
}
type HandlerFn<K extends IntentProofKind> = (
  intent: Extract<IntentProof, { kind: K }>,
  params: SystemParams
) => HandlerResult;

/* internal registry */
const registry: Partial<Record<IntentProofKind, HandlerFn<any>>> = {};

/* helper: register many handlers declaratively */
function registerHandlers<R extends { [K in IntentProofKind]?: HandlerFn<K> }>(
  impl: R
): void {
  Object.assign(registry, impl);
}

/* ------------------------------------------------------------------
 *  Built-in Handlers
 * ----------------------------------------------------------------- */
registerHandlers({
  mint: (i, s) => {
    const o = i.proof.publicOutput;
    const vault = Vault({
      collateralRatio: s.collateralRatio,
      liquidationBonusRatio: s.liquidationBonusRatio,
    })
      .fromState(o.vaultUpdate.vaultState)
      .pack();

    return {
      operations: [
        IntentMapOperation.updateVaultMap(o.vaultUpdate.vaultAddress, vault),
      ],
      roots: {
        vaultMapRoot: i.proof.publicInput.intentVaultMapRoot,
        zkUsdMapRoot: i.proof.publicInput.intentZkUsdMapRoot,
      },
    };
  },

  transfer: (i) => {
    const { nullifiers, outputNoteCommitments } = i.proof.publicOutput;
    const ops: IntentMapOperation[] = [];

    nullifiers.nullifiers.forEach((n) => {
      if (!n.isDummy.toBoolean()) {
        ops.push(IntentMapOperation.setVaultMap(n.nullifier, Note.included()));
      }
    });
    outputNoteCommitments.commitments.forEach((c) => {
      if (!c.isDummy.toBoolean()) {
        ops.push(IntentMapOperation.setZkusdMap(c.commitment, Note.included()));
      }
    });

    return {
      operations: ops,
      roots: { zkUsdMapRoot: i.proof.publicInput.intentZkUsdMapRoot },
    };
  },

  redeem: (i, s) => {
    const o = i.proof.publicOutput;
    const vault = Vault({
      collateralRatio: s.collateralRatio,
      liquidationBonusRatio: s.liquidationBonusRatio,
    })
      .fromState(o.vaultUpdate.vaultState)
      .pack();

    return {
      operations: [
        IntentMapOperation.updateVaultMap(o.vaultUpdate.vaultAddress, vault),
      ],
      roots: { vaultMapRoot: i.proof.publicInput.intentVaultMapRoot },
    };
  },

  'create-vault': (i, s) => {
    const o = i.proof.publicOutput;
    const vault = Vault({
      collateralRatio: s.collateralRatio,
      liquidationBonusRatio: s.liquidationBonusRatio,
    })
      .new(o.vaultType)
      .pack();

    return {
      operations: [IntentMapOperation.insertVaultMap(o.vaultKey.key, vault)],
      roots: { vaultMapRoot: i.proof.publicInput.vaultMapRoot },
    };
  },

  deposit: (i) => ({
    operations: [
      IntentMapOperation.updateVaultMap(
        i.proof.publicOutput.vaultKey.key,
        i.proof.publicOutput.vaultPack
      ),
    ],
    roots: { vaultMapRoot: i.proof.publicInput.vaultMapRoot },
  }),

  liquidate: (i, s) => {
    const o = i.proof.publicOutput;
    const vault = Vault({
      collateralRatio: s.collateralRatio,
      liquidationBonusRatio: s.liquidationBonusRatio,
    })
      .fromState(o.vaultUpdate.vaultState)
      .pack();

    return {
      operations: [
        IntentMapOperation.updateVaultMap(o.vaultUpdate.vaultAddress, vault),
        IntentMapOperation.insertZkusdMap(
          o.outputNoteCommitment.commitment,
          Note.included()
        ),
      ],
      roots: {
        vaultMapRoot: i.proof.publicInput.intentVaultMapRoot,
        zkUsdMapRoot: i.proof.publicInput.intentZkUsdMapRoot,
      },
    };
  },

  burn: () => ({ operations: [], roots: {} }), // placeholder
});

/* ------------------------------------------------------------------
 *  Facade: same API as before, but now uses functional handlers
 * ----------------------------------------------------------------- */
export class IntentProofHelper {
  private get<K extends IntentProofKind>(k: K): HandlerFn<K> {
    const fn = registry[k];
    if (!fn) throw new Error(`No handler registered for kind ${k}`);
    return fn;
  }

  constructor(private readonly sysParams: SystemParams) {}

  extractOperations(intent: IntentProof): IntentMapOperation[] {
    return this.get(intent.kind)(intent as any, this.sysParams).operations;
  }

  stateRoots(intent: IntentProof): IntentStateRoots {
    return this.get(intent.kind)(intent as any, this.sysParams).roots;
  }

  rootsMatch(intent: IntentProof, block: StateRoots): boolean {
    const r = this.stateRoots(intent);
    return IntentProofHelper.intentStateRootsMatchBlock({
      intentStateRoots: r,
      blockStateRoots: block,
    });
  }

  static hash(intent: IntentProof): string {
    return createHash('sha3-256')
      .update(JSON.stringify(intent.proof.toJSON()))
      .digest('hex');
  }

  /**
   * Converts a JsonIntentProof back to an IntentProof by deserializing
   * the proof using the appropriate fromJSON method based on the kind.
   */
  static async fromJSON(
    jsonIntentProof: JsonIntentProof
  ): Promise<IntentProof> {
    const { kind, proof: jsonProof } = jsonIntentProof;

    switch (kind) {
      case 'burn':
        return {
          kind: 'burn',
          proof: await BurnIntentProof.fromJSON(jsonProof),
        };

      case 'mint':
        return {
          kind: 'mint',
          proof: await MintIntentProof.fromJSON(jsonProof),
        };

      case 'transfer':
        return {
          kind: 'transfer',
          proof: await TransferIntentProof.fromJSON(jsonProof),
        };

      case 'redeem':
        return {
          kind: 'redeem',
          proof: await RedeemIntentProof.fromJSON(jsonProof),
        };

      case 'create-vault':
        return {
          kind: 'create-vault',
          proof: await CreateVaultIntentProof.fromJSON(jsonProof),
        };

      case 'deposit':
        return {
          kind: 'deposit',
          proof: await DepositIntentProof.fromJSON(jsonProof),
        };

      case 'liquidate':
        return {
          kind: 'liquidate',
          proof: await LiquidateIntentProof.fromJSON(jsonProof),
        };

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = kind;
        throw new Error(`Unknown intent proof kind: ${kind}`);
    }
  }

  static intentStateRootsMatchBlock(args: {
    intentStateRoots: IntentStateRoots;
    blockStateRoots: StateRoots;
  }): boolean {
    if (
      args.intentStateRoots.vaultMapRoot &&
      !args.intentStateRoots.vaultMapRoot
        .equals(args.blockStateRoots.vaultMapRoot)
        .toBoolean()
    )
      return false;
    if (
      args.intentStateRoots.zkUsdMapRoot &&
      !args.intentStateRoots.zkUsdMapRoot
        .equals(args.blockStateRoots.zkUsdMapRoot)
        .toBoolean()
    )
      return false;
    return true;
  }
}
