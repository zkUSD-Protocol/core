import { Field, method, Proof, SmartContract, state } from 'o1js';
import { SettlementDataPacked } from './data/settlement';
import { ZkUsdRollupProof } from './programs/rollup';

export class ZkUsdSettlementContract extends SmartContract {
  @state(Field) vaultMapRoot: Field;
  @state(Field) zkUsdMapRoot: Field;
  @state(Field) ioMapRoot: Field;
  @state(Field) oraclesHash: Field;
  @state(SettlementDataPacked) packedSettlementData: SettlementDataPacked;

  @method async settle(proof: ZkUsdRollupProof) {
    proof.verify();
  }

  @method async deposit() {
    /*
     *   This method takes a deposit of Mina into the contract.
     *   Then it will use a token (ledger) account of the users public key to
     *   track total deposits and withdrawals. The oracles will monitor events emitted
     *   and only mint the wMina into the users vault once the deposit event is old enough
     *   to pass finality.
     *   The deposit will be used to pay the debt of the contract.
     */
  }

  @method async withdraw() {
    /*
     *   This method will be used to withdraw mina from the contract.
     *   It will take the io map as input and calculate that the withdrawal amount
     *   in the tree is more than the withdrawal amount in the io map and allow the user to
     *   withdraw the difference.
     */
  }
}
