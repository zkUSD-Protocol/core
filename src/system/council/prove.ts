import { Field, PublicKey, Signature, UInt8 } from 'o1js';
import { CouncilTree } from './council-tree.js';
import { MultiSigZkusdProtocolUpdateProgram } from '../../proofs/gov/council-multisig.js';
import { ZkusdProtocolUpdateSpec } from '../update/input.js';

export async function proveProposalSupport(
  updateSpec: ZkusdProtocolUpdateSpec,
  signature: Signature,
  councilTree: CouncilTree,
  seat: UInt8 | number | bigint | PublicKey
) {
  let witness: CouncilTree.Witness;
  // if seat is a public key then wee need to query the treeo
  if (seat instanceof PublicKey) {
    witness = councilTree.getKeyWitness(seat);
  } else {
    const seatIndex = seat instanceof UInt8 ? seat.toBigInt() : seat;
    witness = councilTree.getWitnessWrapped(seatIndex);
  }

  const pubkey =
    seat instanceof PublicKey ? seat : councilTree.getSeatKey(seat);

  const index = witness.calculateIndex().toBigInt();

  const { proof } = await MultiSigZkusdProtocolUpdateProgram.createVote(
    updateSpec,
    signature,
    pubkey,
    witness,
    councilTree.getRoot(),
    Field(1n << index) // The seat index is encoded as 2^index
  );
  return proof;
}
