import { Signed, ZkappCommand } from 'o1js/dist/node/mina-signer/src/types';
import { TransactionArgs } from './../system/transaction';

export type TxProvingInput = {
  txId: string;
  transaction: {
    serializedTx: string;
    signedZkappCommand: Signed<ZkappCommand>;
  };
} & TransactionArgs;

export type TxProvingOutput =
  | {
      success: true;
      serializedProvenTransaction: string;
    }
  | {
      success: false;
      errors: string[];
    };

export interface ITransactionProver {
  proveTransaction(input: TxProvingInput): Promise<TxProvingOutput>;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export type TransactionProvingJob = {
  id: string;
  typ: string;
  assignmentTimeoutMs?: number;
  payload: TxProvingInput;
};
