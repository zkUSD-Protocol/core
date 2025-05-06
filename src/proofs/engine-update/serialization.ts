import { JsonProof } from 'o1js';
import { EngineUpdateVoteProof } from './prove.js';

/**
 * Serializes an EngineUpdateVoteProof to a JSON object.
 * @param proof The proof to serialize.
 * @returns The serialized proof.
 */
export function serializeEngineUpdateProof(
  proof: EngineUpdateVoteProof
): JsonProof {
  return proof.toJSON();
}

function objectIsJsonProof(o: object): o is JsonProof {
  if (typeof o !== 'object') return false;
  if (o === null) return false;
  if (!('publicInput' in o)) return false;
  if (!('publicOutput' in o)) return false;
  if (!('maxProofsVerified' in o)) return false;
  if (!('proof' in o)) return false;
  // also check types
  if (!Array.isArray(o.publicInput)) return false;
  if (!Array.isArray(o.publicOutput)) return false;
  if (typeof o.maxProofsVerified !== 'number') return false;
  if (typeof o.proof !== 'string') return false;
  return true;
}

/**
 * Deserializes a JSON object to an EngineUpdateVoteProof.
 * @param serializedProof The serialized proof.
 * @returns The deserialized proof.
 */
export async function deserializeEngineUpdateProof(
  serializedProof: object
): Promise<EngineUpdateVoteProof> {
  if (!objectIsJsonProof(serializedProof)) {
    throw new Error('Invalid json given.');
  }
  return EngineUpdateVoteProof.fromJSON(serializedProof);
}
