import { Field } from "o1js"

export type MapType = 'zkusd' | 'vault';
export type OperationType = 'insert' | 'update';

export type IntentMapOperation = { mapType: MapType; type: OperationType; key: Field; value: Field; };