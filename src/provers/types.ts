import { TxProvingInput } from './itransactionprover';

export type TransactionExecutionJob = {
  id: string;
  typ: string;
  assignmentTimeoutMs?: number;
  payload: TxProvingInput;
};
