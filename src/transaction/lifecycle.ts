export enum TransactionPhase {
  INITIAL = 'INITIAL',
  AWAITING_FOR_OTHER_TXS = 'AWAITING_FOR_OTHER_TX',
  BUILDING = 'BUILDING',
  PROVING = 'PROVING',
  SIGNING = 'SIGNING',
  SENDING = 'SENDING',
  PENDING_INCLUSION = 'PENDING_INCLUSION',
  INCLUDED = 'INCLUDED',
}

export type TransactionPhaseStatusError = 'FAILED' | 'EXCEPTION';

export type TransactionPhaseStatusNoError = 'IN_PROGRESS' | 'SUCCESS';

export type TransactionPhaseStatus =
  | TransactionPhaseStatusError
  | TransactionPhaseStatusNoError;

export type TransactionStatusNew =
  | {
      phase: TransactionPhase;
      status: TransactionPhaseStatusNoError;
    }
  | {
      phase: TransactionPhase;
      status: TransactionPhaseStatusError;
      errors: any[];
    };

export interface ITransactionLifecycleApi {
  setPhase(phase: TransactionPhase): void;
  addErrors(...error: any[]): void;
  exception(error: any): void;
  success(): void;
}

export class TransactionLifecycleApi implements ITransactionLifecycleApi {
  constructor(
    private readonly setStatus: (status: TransactionStatusNew) => void,
    private readonly getStatus: () => TransactionStatusNew
  ) {}

  setPhase(phase: TransactionPhase) {
    this.setStatus({ phase, status: 'IN_PROGRESS' });
  }

  addErrors(...errors: any[]) {
    this.updateStatusWithErrors('FAILED', errors);
  }

  exception(...errors: any[]) {
    this.updateStatusWithErrors('EXCEPTION', errors);
  }

  success() {
    this.setStatus({ phase: this.getStatus().phase, status: 'SUCCESS' });
  }

  private updateStatusWithErrors(
    status: TransactionPhaseStatusError,
    errors: any[]
  ) {
    const currentStatus = this.getStatus();
    const { phase } = currentStatus;

    const newErrors =
      currentStatus.status === 'FAILED' || currentStatus.status === 'EXCEPTION'
        ? [...currentStatus.errors, ...errors]
        : errors;

    this.setStatus({ phase, status, errors: newErrors });
  }
}
