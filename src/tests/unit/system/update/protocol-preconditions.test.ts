/*****************************************************************************************
 *  tests/protocol-preconditions.test.ts
 *
 *  Unit‑tests for:
 *    • ZkusdUpdateProtocolState.isValidForPreconditions()
 *
 *  Uses Node’s native runner (node:test) and the `o1js` primitives.
 *****************************************************************************************/

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { Bool, Field, UInt8, UInt64 } from 'o1js';

import { ZkusdUpdateProtocolState } from '../../../../system/update/protocol-state.js';
import { ZkusdProtocolPreconditions } from '../../../../system/update/protocol-preconditions.js';

import {
  BoolPrecondition,
  HashPrecondition,
  UInt8Precondition,
  UInt64Precondition,
} from '../../../../system/update/simple-preconditions.js';

/* -------------------------------------------------------------------------- */
/*                           Test Setup Utilities                             */
/* -------------------------------------------------------------------------- */

let protocolState: ZkusdUpdateProtocolState;
let hash1: Field, hash2: Field;
let debtCeiling: UInt64;

/** A convenient UInt64 max constant (2^64‑1) for edge‑case checks. */
const UINT64_MAX = UInt64.from(UInt64.MAXINT());

beforeEach(() => {
  hash1 = Field.random();
  hash2 = Field.random();

  // 10 000 000 is arbitrary: just a realistic non‑edge value.
  debtCeiling = UInt64.from(10_000_000n);

  protocolState = new ZkusdUpdateProtocolState({
    emergencyStop: Bool(false),
    collateralRatio: UInt8.from(150),
    validPriceBlockCount: UInt8.from(12),
    liquidationBonusRatio: UInt8.from(5),
    oracleWhitelistHash: hash1,
    configMerkleRoot: hash2,
    vaultCreationDisabled: Bool(false),
    vaultDebtCeiling: debtCeiling,
  });
});

/* -------------------------------------------------------------------------- */
/*                              Test Suite                                    */
/* -------------------------------------------------------------------------- */

describe('ZkusdUpdateProtocolState.isValidForPreconditions()', () => {
  it('returns true when all preconditions are unconstrained', () => {
    const unconstrained = ZkusdProtocolPreconditions.create();
    assert.ok(protocolState.isValidForPreconditions(unconstrained).toBoolean());
  });

  it('returns true when all fields exactly match strict equality preconditions', () => {
    const strictP = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(false),
      collateralRatio: UInt8Precondition.equal(150),
      validPriceBlockCount: UInt8Precondition.equal(12),
      liquidationBonusRatio: UInt8Precondition.equal(5),
      oracleWhitelistHash: HashPrecondition.equal(hash1),
      configMerkleRoot: HashPrecondition.equal(hash2),
      vaultCreationDisabled: BoolPrecondition.equal(false),
      vaultDebtCeiling: UInt64Precondition.equal(debtCeiling),
    });
    assert.ok(protocolState.isValidForPreconditions(strictP).toBoolean());
  });

  /* -------------------- Failing cases for individual fields -------------------- */

  it('returns false if emergencyStop mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(true),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  it('returns false if collateralRatio mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.equal(200),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  it('returns false if validPriceBlockCount mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      validPriceBlockCount: UInt8Precondition.equal(15),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  it('returns false if liquidationBonusRatio mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      liquidationBonusRatio: UInt8Precondition.equal(10),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  it('returns false if oracleWhitelistHash mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      oracleWhitelistHash: HashPrecondition.equal(Field.random()),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  it('returns false if configMerkleRoot mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      configMerkleRoot: HashPrecondition.equal(Field.random()),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  /* ---------------------- NEW BOOL field: vaultCreationDisabled ---------------------- */

  it('returns false if vaultCreationDisabled mismatches', () => {
    const failP = ZkusdProtocolPreconditions.create({
      vaultCreationDisabled: BoolPrecondition.equal(true),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  /* --------------------- NEW UInt64 field: vaultDebtCeiling --------------------- */

  it('returns false if vaultDebtCeiling mismatches on strict equality', () => {
    const failP = ZkusdProtocolPreconditions.create({
      vaultDebtCeiling: UInt64Precondition.equal(UInt64.from(1_000_000n)),
    });
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  /* ----------------------------- Hash / UInt8 variants ----------------------------- */

  it('handles HashPrecondition.differentThan() correctly', () => {
    const okP = ZkusdProtocolPreconditions.create({
      oracleWhitelistHash: HashPrecondition.differentThan(Field.random()),
    });
    const failP = ZkusdProtocolPreconditions.create({
      oracleWhitelistHash: HashPrecondition.differentThan(hash1),
    });

    assert.ok(protocolState.isValidForPreconditions(okP).toBoolean());
    assert.ok(protocolState.isValidForPreconditions(failP).not().toBoolean());
  });

  /* -------------------- Mixed constrained / unconstrained paths -------------------- */

  it('accepts when only some fields are constrained and all constrained fields match', () => {
    const partialP = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(false),
      collateralRatio: UInt8Precondition.equal(150),
      vaultDebtCeiling: UInt64Precondition.unconstrained(),
    });
    assert.ok(protocolState.isValidForPreconditions(partialP).toBoolean());
  });

  it('rejects if one constrained field fails even if others are unconstrained', () => {
    const partialFail = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(true), // wrong
      collateralRatio: UInt8Precondition.unconstrained(),
    });
    assert.ok(
      protocolState.isValidForPreconditions(partialFail).not().toBoolean()
    );
  });

  /* ------------------------------ Edge‑value checks ------------------------------ */

  it('handles edge values for UInt8 and UInt64 fields', () => {
    const edgeState = new ZkusdUpdateProtocolState({
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(0),
      validPriceBlockCount: UInt8.from(255),
      liquidationBonusRatio: UInt8.from(255),
      oracleWhitelistHash: hash1,
      configMerkleRoot: hash2,
      vaultCreationDisabled: Bool(true),
      vaultDebtCeiling: UINT64_MAX,
    });

    const edgeP = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.equal(0),
      validPriceBlockCount: UInt8Precondition.equal(255),
      liquidationBonusRatio: UInt8Precondition.equal(255),
      vaultCreationDisabled: BoolPrecondition.equal(true),
      vaultDebtCeiling: UInt64Precondition.equal(UINT64_MAX),
    });

    assert.ok(edgeState.isValidForPreconditions(edgeP).toBoolean());
  });
});
