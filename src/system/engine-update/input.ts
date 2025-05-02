/**
 * ZKUSD Protocol Update Specification Module
 *
 * Defines a specification struct representing a complete ZKUSD protocol update operation,
 * including governance resolution index, blockchain preconditions, protocol preconditions,
 * and the specific update operation.
 */

import { Field, Poseidon, Struct, UInt32 } from 'o1js';
import { ZkusdProtocolPreconditions } from './protocol-preconditions.js';
import { MinaChainPreconditions } from './blockchain-preconditions.js';
import {
  EngineUpdateOperation,
  EngineUpdateOperationFields,
} from './operation.js';

/**
 * Represents a full specification for a ZKUSD protocol update.
 *
 * Properties:
 * - `govResolutionIndex` — Governance resolution that authorizes the update.
 * - `protocolUpdatePreconditions` — Preconditions that must be satisfied for the update.
 * - `blockchainPreconditions` — Preconditions over the Mina blockchain state.
 * - `protocolUpdateOperation` — The set of specific operations (e.g., parameter change, council update).
 */
export class EngineUpdateSpec extends Struct({
  govResolutionIndex: UInt32,
  protocolUpdatePreconditions: ZkusdProtocolPreconditions,
  blockchainPreconditions: MinaChainPreconditions,
  protocolUpdateOperation: EngineUpdateOperation,
}) {
  /**
   * Creates an empty (no-op) protocol update spec.
   *
   * Useful for placeholders or default values.
   *
   * @example
   * const emptySpec = EngineUpdateSpec.empty();
   */
  static empty(): EngineUpdateSpec {
    return new EngineUpdateSpec({
      govResolutionIndex: UInt32.zero,
      protocolUpdatePreconditions: ZkusdProtocolPreconditions.create(),
      blockchainPreconditions: MinaChainPreconditions.always(),
      protocolUpdateOperation: EngineUpdateOperation.noop(),
    });
  }

  /**
   * Creates a protocol update spec with a single operation and optional preconditions.
   *
   * @param resolutionIndex - The resolution index authorizing the update.
   * @param protocolUpdateOperation - The update operation to perform.
   * @param args.blockchainPreconditions - (Optional) Blockchain preconditions.
   * @param args.protocolPreconditions - (Optional) Protocol-specific preconditions.
   *j
   * @example
   * const spec = EngineUpdateSpec.singleOperation(
   *   42,
   *   EngineUpdateOperation.create({emergencyStop: BoolOperation.set(Bool(true))}),
   *   {
   *     blockchainPreconditions: MinaChainPreconditions.before({ block: UInt32.from(50000) })
   *   }
   * );
   */
  static singleOperation(
    resolutionIndex: string | number | bigint | UInt32,
    protocolUpdateOperation:
      | EngineUpdateOperation
      | Partial<EngineUpdateOperationFields>,
    args?: {
      blockchainPreconditions?: MinaChainPreconditions;
      protocolPreconditions?: ZkusdProtocolPreconditions;
    }
  ): EngineUpdateSpec {
    // if protocolUpdateOperation is not an instance of EngineUpdateOperation,
    // create it from the partial fields
    let operation: EngineUpdateOperation;
    if (protocolUpdateOperation instanceof EngineUpdateOperation) {
      operation = protocolUpdateOperation;
    } else {
      operation = EngineUpdateOperation.create(protocolUpdateOperation);
    }
    return mkProtocolUpdateInput(resolutionIndex, operation, args);
  }

  /**
   * Converts the EngineUpdateSpec into an array of Fields for circuit operations.
   */
  toFields(): Field[] {
    return [
      ...this.govResolutionIndex.toFields(),
      ...this.protocolUpdatePreconditions.toFields(),
      ...this.blockchainPreconditions.toFields(),
      ...this.protocolUpdateOperation.toFields(),
    ];
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }
}

/**
 * Internal utility function to create a protocol update input spec.
 *
 * @private
 */
function mkProtocolUpdateInput(
  resolutionIndex: string | number | bigint | UInt32,
  protocolUpdateOperation: EngineUpdateOperation,
  args?: {
    blockchainPreconditions?: MinaChainPreconditions;
    protocolPreconditions?: ZkusdProtocolPreconditions;
  }
): EngineUpdateSpec {
  const blockchainPreconditions =
    args?.blockchainPreconditions ?? MinaChainPreconditions.always();

  const protocolUpdatePreconditions =
    args?.protocolPreconditions ?? ZkusdProtocolPreconditions.create();

  return new EngineUpdateSpec({
    govResolutionIndex: UInt32.from(resolutionIndex),
    protocolUpdateOperation,
    protocolUpdatePreconditions,
    blockchainPreconditions,
  });
}
