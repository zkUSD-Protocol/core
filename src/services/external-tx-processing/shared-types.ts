import {
  FailedBeforeSending,
  RejectedOnReceive,
} from '../../mina/transaction-status';

export { ProvingResult, SendingResult };

type ProvingResult =
  | { success: true; proofs: string[] }
  | { success: false; status: FailedBeforeSending };

type SendingResult =
  | { success: true; hash: string; status: 'Pending' }
  | { success: false; status: RejectedOnReceive | FailedBeforeSending };
