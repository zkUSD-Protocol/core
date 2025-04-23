import { PrivateKey, Signature } from "o1js";
import { FieldsSigner } from "./types.js";
import { Field } from "o1js/dist/node/lib/provable/field.js";


export class MockFieldsSigner implements FieldsSigner {
  constructor(public key: PrivateKey | undefined = undefined) {}
  async signFields(fields: Field[]): Promise<Signature> {
    if(!this.key){
      throw new Error("Provide signing key before use.")
    }
    return Signature.create(this.key, fields);
  }
}
