import { Field, Struct } from 'o1js';
import { CouncilMapProvable } from '../data/council-map.js';

export class CouncilUpdateVoteOutput extends Struct({
  updatedCouncilMap: CouncilMapProvable,
  cummulatedVoteBitArray: Field,
}) {}
