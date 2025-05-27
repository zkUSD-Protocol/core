/**
 * intent-proof-store.ts
 *
 * A generic interface and SQLite implementation for persisting AnyIntentProofs.
 * ---------------------------------------------------------------------------
 * • Interface:   IntentProofStore              – abstraction for any backing store
 * • Class:       SqliteIntentProofStore        – production-grade better-sqlite3 impl
 * ---------------------------------------------------------------------------
 * Requirements
 *   npm i better-sqlite3
 * ---------------------------------------------------------------------------
 */

import Database from 'better-sqlite3';
import { Field } from 'o1js';
import path from 'path';
import fs from 'fs';

import {
  AnyIntentProof,
  IntentProofKind,
  hashAnyIntentProof,
} from './types/intent-proof.js';

import {
  BurnIntentProof,
  MintIntentProof,
  TransferIntentProof,
  RedeemIntentProof,
  CreateVaultIntentProof,
  DepositIntentProof,
  LiquidateIntentProof,
} from './programs/intents/index.js';

/* ------------------------------------------------------------------ */
/*  IntentProofStore interface                                               */
/* ------------------------------------------------------------------ */

export interface IntentProofStore {
  /**
   * Persist a proof (idempotent). Returns its Field hash.
   */
  storeProof(proof: AnyIntentProof): string;

  /**
   * Retrieve a proof (or null) by its Field hash.
   */
  getProof(hash: string): Promise<AnyIntentProof | null>;
}

/* ------------------------------------------------------------------ */
/*  SQLite implementation                                              */
/* ------------------------------------------------------------------ */

export class SqliteIntentProofStore implements IntentProofStore {
  private db: Database.Database;

  private readonly insertStmt = /* sql */ `
    INSERT OR IGNORE INTO proofs (hash, kind, proof_json, created_at)
    VALUES (?, ?, ?, ?);
  `;

  private readonly selectStmt = /* sql */ `
    SELECT kind, proof_json FROM proofs WHERE hash = ?;
  `;

  constructor(dbPath = 'data/proofs.db') {
    // Ensure the directory exists
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.exec(/* sql */ `
    CREATE TABLE IF NOT EXISTS proofs (
      hash        TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      proof_json  TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `);
}

  /* ---------------- IntentProofStore implementation -------------------- */

  storeProof(proof: AnyIntentProof): string {
    const key  = hashAnyIntentProof(proof);
    const json = JSON.stringify(proof.proof.toJSON());

    this.db
      .prepare(this.insertStmt)
      .run(key, proof.kind, json, Date.now());

    return key;
  }

  async getProof(hash: string): Promise<AnyIntentProof | null> {
    const row = this.db
      .prepare(this.selectStmt)
      .get(hash) as { kind: IntentProofKind; proof_json: string } | undefined;

    if (!row) return null;

    const parsed = JSON.parse(row.proof_json);

    // Map `kind` → appropriate Proof.fromJSON
    switch (row.kind) {
      case 'burn':         return { kind: 'burn',         proof: await BurnIntentProof.fromJSON(parsed) };
      case 'mint':         return { kind: 'mint',         proof: await MintIntentProof.fromJSON(parsed) };
      case 'transfer':     return { kind: 'transfer',     proof: await TransferIntentProof.fromJSON(parsed) };
      case 'redeem':       return { kind: 'redeem',       proof: await RedeemIntentProof.fromJSON(parsed) };
      case 'create-vault': return { kind: 'create-vault', proof: await CreateVaultIntentProof.fromJSON(parsed) };
      case 'deposit':      return { kind: 'deposit',      proof: await DepositIntentProof.fromJSON(parsed) };
      case 'liquidate':    return { kind: 'liquidate',    proof: await LiquidateIntentProof.fromJSON(parsed) };
      /* c8 ignore next */
      default:
        throw new Error(`Unknown proof kind stored in DB: ${row.kind}`);
    }
  }
}