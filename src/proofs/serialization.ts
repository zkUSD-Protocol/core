import { JsonProof } from 'o1js';

/**
 * Serializes an object that implements the toJSON() method to a JSON object.
 * @param obj The object to serialize.
 * @returns The serialized object.
 */
export function serializeToJson<T extends { toJSON(): JsonProof }>(obj: T): JsonProof {
  return obj.toJSON();
}

/**
 * Deserializes a JSON object to an object that implements the fromJSON() method.
 * @param serializedObj The serialized object.
 * @returns The deserialized object.
 */
export async function deserializeFromJson<T>(
  serializedObj: object,
  clazz: { fromJSON(json: JsonProof): T }
): Promise<T> {
  if (!objectIsJsonProof(serializedObj)) {
    throw new Error('Invalid json given.');
  }
  return clazz.fromJSON(serializedObj as JsonProof);
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
