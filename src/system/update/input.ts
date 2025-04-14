import { Field, Struct, UInt32 } from 'o1js';
import { ZkusdProtocolPreconditions } from './protocol-preconditions.js';
import { MinaChainPreconditions } from './blockchain-preconditions.js';
import { ZkusdProtocolUpdateOperation } from './operation.js';

export class ZkusdProtocolUpdateSpec extends Struct({
  govResolutionIndex: UInt32,
  protocolUpdatePreconditions: ZkusdProtocolPreconditions,
  blockchainPreconditions: MinaChainPreconditions,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
}) {

  static empty(): ZkusdProtocolUpdateSpec {
    return new ZkusdProtocolUpdateSpec({
      govResolutionIndex: UInt32.zero,
      protocolUpdatePreconditions: ZkusdProtocolPreconditions.create(),
      blockchainPreconditions: MinaChainPreconditions.always(),
      protocolUpdateOperation: ZkusdProtocolUpdateOperation.mkNoop(),
    });
  }

  static singleOperation(
    resolutionIndex: number,
    protocolUpdateOperation: ZkusdProtocolUpdateOperation,
    args?: {
      blockchainPreconditions?: MinaChainPreconditions;
      protocolPreconditions?: ZkusdProtocolPreconditions;
    }
  ): ZkusdProtocolUpdateSpec {
    return mkProtocolUpdateInput(resolutionIndex, protocolUpdateOperation, args);
  }

  toFields(): Field[] {
    return [
      ...this.govResolutionIndex.toFields(),
      ...this.protocolUpdatePreconditions.toFields(),
      ...this.blockchainPreconditions.toFields(),
      ...this.protocolUpdateOperation.toFields(),
    ];
  }
}

function mkProtocolUpdateInput(
  resolutionIndex: number,
  protocolUpdateOperation: ZkusdProtocolUpdateOperation,
  args?: {
    blockchainPreconditions?: MinaChainPreconditions;
    protocolPreconditions?: ZkusdProtocolPreconditions;
  }
): ZkusdProtocolUpdateSpec {

  const blockchainPreconditions =
    args?.blockchainPreconditions ?? MinaChainPreconditions.always();

  const protocolUpdatePreconditions =
    args?.protocolPreconditions ??
    ZkusdProtocolPreconditions.create();

  return new ZkusdProtocolUpdateSpec({
    govResolutionIndex: UInt32.from(resolutionIndex),
    protocolUpdateOperation,
    protocolUpdatePreconditions,
    blockchainPreconditions,
  });
};
