import { Field, Struct } from 'o1js';
import { CouncilMapProvable } from '../council-map.js';

export class ZkusdCouncilManagementOutput extends Struct({
  updatedCouncilMap: CouncilMapProvable,
  cummulatedVoteBitArray: Field,
}) {}
