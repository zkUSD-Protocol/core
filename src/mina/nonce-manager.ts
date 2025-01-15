import { Field, PublicKey, UInt32 } from "o1js";

interface INonceManager {
  getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32>;
}

class NonceManager implements INonceManager {
  public getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32>{
    return Promise.resolve(new UInt32(0));
  }

}

export {INonceManager, NonceManager};
