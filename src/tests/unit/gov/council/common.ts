import {
  CouncilUpdateActionEvent,
  EngineUpdateProposalPassedEvent,
  EngineUpdateProposalVoteEvent,
} from '../../../../system/council/events.js';
import { Signature, UInt32, PublicKey, Field } from 'o1js';
import { KeyPair } from '../../../../types/utility.js';
import {
  EngineUpdate,
  EngineUpdateVoteProof,
} from '../../../../proofs/engine-update/prove.js';
import { EngineUpdateSpec } from '../../../../system/engine-update/input.js';
import { TestHelper } from '../../../test-helper.js';
import { CouncilUpdateOperation } from '../../../../system/council/update/common.js';
import { ProposalMap } from '../../../../system/council/data/proposal-merkle-map.js';
import { ResolutionTree } from '../../../../system/council/data/resolution-tree.js';
import { CouncilMap } from '../../../../system/council/data/council-map.js';
import { Seat } from '../../../../system/council/seat.js';

export async function generateVoteProof(
  councilMember: KeyPair,
  councilMap: CouncilMap,
  seatKey: Seat,
  govResolutionIndex: number = 0,
  updateSpec: EngineUpdateSpec = EngineUpdateSpec.empty()
): Promise<EngineUpdateVoteProof> {
  // an example of a update - an empty one, but its okay for these tests.
  updateSpec.govResolutionIndex = UInt32.from(govResolutionIndex);
  const updateInputFields = updateSpec.toFields();
  const signature = Signature.create(
    councilMember.privateKey,
    updateInputFields
  );

  const { proof } = await EngineUpdate.createVote(
    updateSpec,
    signature,
    councilMember.publicKey,
    councilMap.provable,
    seatKey
  );
  return proof;
}
