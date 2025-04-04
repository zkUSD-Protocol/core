import { Field, Provable, Struct } from 'o1js';


/**
 * Output of the proof, including whether it's final or not.
 */
export class ZkusdProtocolUpdateOutput extends Struct({
  protocolUpdateHash: Field,
  auxilliaryOutput: Provable.Array(Field, 4),
  isFinalProof: Field, // set to YesItIsAFinalZkusdProtocolUpdateProof if final
}) {}

export const NotAFinalZkusdProtocolUpdateProof = Field(0);
export const YesItIsAFinalZkusdProtocolUpdateProof = Field(
  25329768464765890060619421345429226387561522247782730071636646908705875653989n
);
