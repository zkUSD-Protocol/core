import { Struct } from 'o1js';
import { ZkUsdState } from './common';

/**
 * Public output for the ZkUSD program.
 */
export class ZkUsdOutput extends Struct({
  // New state after the operation
  state: ZkUsdState,
  // Any additional outputs needed
  // e.g., new note commitments, etc.
}) {}
