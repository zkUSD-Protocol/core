/**
 * ZKUSD Protocol Update Specification Module
 *
 * Defines a specification struct representing a complete ZKUSD protocol update operation,
 * including governance resolution index, blockchain preconditions, protocol preconditions,
 * and the specific update operation.
 */

import { Field, Struct, UInt32 } from 'o1js';
import { ZkusdProtocolPreconditions } from './protocol-preconditions.js';
import { MinaChainPreconditions } from './blockchain-preconditions.js';
import { ZkusdProtocolUpdateOperation } from './operation.js';

/**
 * Represents a full specification for a ZKUSD protocol update.
 *
 * Properties:
 * - `govResolutionIndex` — Governance resolution that authorizes the update.
 * - `protocolUpdatePreconditions` — Preconditions that must be satisfied for the update.
 * - `blockchainPreconditions` — Preconditions over the Mina blockchain state.
 * - `protocolUpdateOperation` — The set of specific operations (e.g., parameter change, council update).
 */
export class ZkusdProtocolUpdateSpec extends Struct({
  govResolutionIndex: UInt32,
  protocolUpdatePreconditions: ZkusdProtocolPreconditions,
  blockchainPreconditions: MinaChainPreconditions,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
}) {

  /**
   * Creates an empty (no-op) protocol update spec.
   *
   * Useful for placeholders or default values.
   *
   * @example
   * const emptySpec = ZkusdProtocolUpdateSpec.empty();
   */
  static empty(): ZkusdProtocolUpdateSpec {
    return new ZkusdProtocolUpdateSpec({
      govResolutionIndex: UInt32.zero,
      protocolUpdatePreconditions: ZkusdProtocolPreconditions.create(),
      blockchainPreconditions: MinaChainPreconditions.always(),
      protocolUpdateOperation: ZkusdProtocolUpdateOperation.noop(),
    });
  }

  /**
   * Creates a protocol update spec with a single operation and optional preconditions.
   *
   * @param resolutionIndex - The resolution index authorizing the update.
   * @param protocolUpdateOperation - The update operation to perform.
   * @param args.blockchainPreconditions - (Optional) Blockchain preconditions.
   * @param args.protocolPreconditions - (Optional) Protocol-specific preconditions.
   *
   * @example
   * const spec = ZkusdProtocolUpdateSpec.singleOperation(
   *   42,
   *   ZkusdProtocolUpdateOperation.create({emergencyStop: BoolOperation.set(Bool(true))}),
   *   {
   *     blockchainPreconditions: MinaChainPreconditions.before({ block: UInt32.from(50000) })
   *   }
   * );
   */
  static singleOperation(
    resolutionIndex: string | number | bigint | UInt32,
    protocolUpdateOperation: ZkusdProtocolUpdateOperation,
    args?: {
      blockchainPreconditions?: MinaChainPreconditions;
      protocolPreconditions?: ZkusdProtocolPreconditions;
    }
  ): ZkusdProtocolUpdateSpec {
    return mkProtocolUpdateInput(resolutionIndex, protocolUpdateOperation, args);
  }

  /**
   * Converts the ZkusdProtocolUpdateSpec into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [
      ...this.govResolutionIndex.toFields(),
      ...this.protocolUpdatePreconditions.toFields(),
      ...this.blockchainPreconditions.toFields(),
      ...this.protocolUpdateOperation.toFields(),
    ];
  }
}

/**
 * Internal utility function to create a protocol update input spec.
 *
 * @private
 */
function mkProtocolUpdateInput(
  resolutionIndex: string | number | bigint | UInt32,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
  args?: {
    blockchainPreconditions?: MinaChainPreconditions;
    protocolPreconditions?: ZkusdProtocolPreconditions;
  }
): ZkusdProtocolUpdateSpec {
  const blockchainPreconditions =
    args?.blockchainPreconditions ?? MinaChainPreconditions.always();

  const protocolUpdatePreconditions =
    args?.protocolPreconditions ?? ZkusdProtocolPreconditions.create();

  return new ZkusdProtocolUpdateSpec({
    govResolutionIndex: UInt32.from(resolutionIndex),
    protocolUpdateOperation,
    protocolUpdatePreconditions,
    blockchainPreconditions,
  });
}
