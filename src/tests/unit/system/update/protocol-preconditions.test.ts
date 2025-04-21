/*****************************************************************************************
 *  tests/protocol-preconditions.test.ts
 *
 *  Unit‑tests for:
 *    • ZkusdUpdatedProtocolState.isValidForPreconditions()
 *
 *  Uses Node’s native runner (node:test) and the `o1js` primitives.
 *****************************************************************************************/

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { Bool, Field, UInt8 } from 'o1js';

import { ZkusdUpdatedProtocolState } from '../../../../system/update/protocol-state.js';
import { ZkusdProtocolPreconditions } from '../../../../system/update/protocol-preconditions.js';

import {
  BoolPrecondition,
  HashPrecondition,
  UInt8Precondition,
} from '../../../../system/update/simple-preconditions.js';

/* -------------------------------------------------------------------------- */
/*                           Test Setup Utilities                             */
/* -------------------------------------------------------------------------- */

let protocolState: ZkusdUpdatedProtocolState;
let hash1: Field, hash2: Field;

beforeEach(() => {
  hash1 = Field.random();
  hash2 = Field.random();

  protocolState = new ZkusdUpdatedProtocolState({
    emergencyStop: Bool(false),
    collateralRatio: UInt8.from(150),
    validPriceBlockCount: UInt8.from(12),
    liquidationBonusRatio: UInt8.from(5),
    oracleWhitelistHash: hash1,
    configMerkleRoot: hash2,
  });
});

/* -------------------------------------------------------------------------- */
/*                              Test Suite                                    */
/* -------------------------------------------------------------------------- */

describe('ZkusdUpdatedProtocolState.isValidForPreconditions()', () => {
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
    });
    assert.ok(protocolState.isValidForPreconditions(strictP).toBoolean());
  });

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

  it('handles UInt8Precondition.greaterThan() and greaterOrEqual() correctly', () => {
    const greaterOk = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.greaterOrEqual(100),
    });
    const greaterFail = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.greaterThan(200),
    });

    assert.ok(protocolState.isValidForPreconditions(greaterOk).toBoolean());
    assert.ok(protocolState.isValidForPreconditions(greaterFail).not().toBoolean());
  });

  it('handles UInt8Precondition.lessThan() and lessOrEqual() correctly', () => {
    const lessOk = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.lessOrEqual(200),
    });
    const lessFail = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.lessThan(100),
    });

    assert.ok(protocolState.isValidForPreconditions(lessOk).toBoolean());
    assert.ok(protocolState.isValidForPreconditions(lessFail).not().toBoolean());
  });

  it('accepts when only some fields are constrained and all constrained fields match', () => {
    const partialP = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(false),
      collateralRatio: UInt8Precondition.equal(150),
    });
    assert.ok(protocolState.isValidForPreconditions(partialP).toBoolean());
  });

  it('rejects if one constrained field fails even if others are unconstrained', () => {
    const partialFail = ZkusdProtocolPreconditions.create({
      emergencyStop: BoolPrecondition.equal(true), // wrong
      collateralRatio: UInt8Precondition.unconstrained(),
    });
    assert.ok(protocolState.isValidForPreconditions(partialFail).not().toBoolean());
  });

  it('handles edge values for UInt8 fields', () => {
    const edgeState = new ZkusdUpdatedProtocolState({
      emergencyStop: Bool(false),
      collateralRatio: UInt8.from(0),
      validPriceBlockCount: UInt8.from(255),
      liquidationBonusRatio: UInt8.from(255),
      oracleWhitelistHash: hash1,
      configMerkleRoot: hash2,
    });

    const edgeP = ZkusdProtocolPreconditions.create({
      collateralRatio: UInt8Precondition.equal(0),
      validPriceBlockCount: UInt8Precondition.equal(255),
      liquidationBonusRatio: UInt8Precondition.equal(255),
    });

    assert.ok(edgeState.isValidForPreconditions(edgeP).toBoolean());
  });
});
