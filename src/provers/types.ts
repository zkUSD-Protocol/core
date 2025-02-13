import { TxProvingInput } from './itransactionprover.js';

export type TransactionExecutionJob = {
  id: string;
  typ: string;
  assignmentTimeoutMs?: number;
  payload: TxProvingInput;
};
