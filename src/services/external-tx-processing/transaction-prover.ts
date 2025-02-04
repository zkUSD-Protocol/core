import { Transaction } from 'o1js';
import { IProver, ProvingJob, ProvingJobType } from './shared-types.js';

export class TransactionProver
  implements IProver<ProvingJobType.ProveTransaction>
{
  readonly supportedJobTypes: ProvingJobType.ProveTransaction[] = [
    ProvingJobType.ProveTransaction,
  ];

  async proveJob(job: ProvingJob[ProvingJobType.ProveTransaction]) {
    const json = JSON.parse(job.payload.serializedTransaction);
    const transaction = Transaction.fromJSON(json);

    await transaction.prove();

    // Prove the transaction and return the result
    return {
      serializedTransaction: transaction.toJSON(),
    };
  }
}
