import { FailedBeforeSending } from '../../mina/transaction-status';

export { ProvingResult };

type ProvingResult =
  | { success: true; serializedTx: string }
  | { success: false; status: FailedBeforeSending };
