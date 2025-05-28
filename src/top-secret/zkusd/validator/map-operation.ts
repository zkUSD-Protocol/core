import { Field, Poseidon } from "o1js"

export type MapType = 'zkusd' | 'vault';
export type OperationType = 'insert' | 'update' | 'set';

// TODO we need canonical representation and hash
export class IntentMapOperation {
    constructor(
        readonly mapType: MapType,
        readonly type: OperationType,
        readonly key: Field,
        readonly value: Field
    ) {}

    // provisional
    hash(): Field {
        return Poseidon.hash([
            Field(this.mapType),
            Field(this.type),
            this.key,
            this.value
        ]);
    }

    // TODO check
    static rollingHash(operations: IntentMapOperation[]): Field {
        return operations.reduce((hash, operation) => {
            return Poseidon.hash([hash, operation.hash()]);
        }, Field.from(0));
    }

    static updateVaultMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'vault',
            'update',
            key,
            value
        );
    }

    static updateZkusdMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'zkusd',
            'update',
            key,
            value
        );
    }
    
    static insertVaultMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'vault',
            'insert',
            key,
            value
        );
    }

    static insertZkusdMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'zkusd',
            'insert',
            key,
            value
        );
    }

    static setZkusdMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'zkusd',
            'set',
            key,
            value
        );
    }
    
    static setVaultMap(key: Field, value: Field): IntentMapOperation {
        return new IntentMapOperation(
            'vault',
            'set',
            key,
            value
        );
    }
}