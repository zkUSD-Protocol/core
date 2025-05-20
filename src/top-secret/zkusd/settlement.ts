import { Field, SmartContract, state } from 'o1js';
import { SettlementDataPacked } from './data/settlement';

export class ZkUsdSettlementContract extends SmartContract {
  @state(Field) vaultMapRoot: Field;
  @state(Field) zkUsdMapRoot: Field;
  @state(Field) oraclesHash: Field;
  @state(SettlementDataPacked) packedSettlementData: SettlementDataPacked;
}
