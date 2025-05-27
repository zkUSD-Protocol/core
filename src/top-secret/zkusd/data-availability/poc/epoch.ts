import fs from 'fs';
import path from 'path';
import { ZkUsdMap } from '../../data/maps/zkusd-map.js';
import { Field, Poseidon } from 'o1js';

export class Epoch {
  private epoch: number;
  private previousRoot: string;
  private previousLength: string;
  private zkusdMap: ZkUsdMap;

  constructor(epoch: number, zkusdMap: ZkUsdMap) {
    this.epoch = epoch;
    this.zkusdMap = zkusdMap;
    this.previousRoot = this.zkusdMap.root.toString();
    this.previousLength = this.zkusdMap.length.toString();
  }

  //Generate the new epoch file
  public processEpoch(
    rawOperations: ZkUsdMapOperation[],
    previousEpochHash: string
  ): EpochMetadata {
    const operations: Operation[] = [];

    //apply the operations to the zkusd map
    for (const rawOperation of rawOperations) {
      const operation = this.applyOperation(rawOperation);
      operations.push(operation);
    }

    //write the epoch file to the disk
    fs.writeFileSync(
      path.join(
        process.cwd(),
        `/src/top-secret/zkusd/data-availability/poc/da/zkusd_tree_epoch_${this.epoch}.json`
      ),
      JSON.stringify({
        epoch: this.epoch,
        startSequence: rawOperations[0].sequence,
        endSequence: rawOperations[rawOperations.length - 1].sequence,
        previousRoot: this.previousRoot,
        previousLength: this.previousLength,
        newRoot: this.zkusdMap.root.toString(),
        newLength: this.zkusdMap.length.toString(),
        operations: operations,
        operationCounts: {
          inserts: operations.filter((operation) => operation.type === 'insert')
            .length,
          updates: operations.filter((operation) => operation.type === 'update')
            .length,
        },
      })
    );

    return {
      epoch: this.epoch,
      root: this.zkusdMap.root.toString(),
      length: this.zkusdMap.length.toString(),
      timestamp: Date.now(),
      operationCount: rawOperations.length,
      epochHash: Poseidon.hash(
        operations.map((operation) => Field.from(operation.key))
      ).toString(),
      previousEpochHash: previousEpochHash,
    };
  }

  //Generate the new epoch file
  public applyOperation(rawOperation: ZkUsdMapOperation): Operation {
    //check if the operation is a valid operation
    this.zkusdMap.insert(
      Field.from(rawOperation.key),
      Field.from(rawOperation.value)
    );

    const operation = {
      sequence: rawOperation.sequence,
      mapType: MapType.ZKUSD,
      type: rawOperation.type,
      key: rawOperation.key,
      value: rawOperation.value,
    };

    return operation;
  }
}
