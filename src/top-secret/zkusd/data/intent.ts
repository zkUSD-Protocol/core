import { Field, Struct } from 'o1js';

export class ZkUsdIntentInput extends Struct({
  vaultMapRoot: Field,
  zkUsdMapRoot: Field,
}) {}

export class ZkUsdIntentOutput extends Struct({
  vaultMapRoot: Field,
  zkUsdMapRoot: Field,
}) {}
