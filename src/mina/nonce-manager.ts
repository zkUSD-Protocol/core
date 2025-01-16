import { Field, PublicKey, UInt32 } from "o1js";

interface INonceManager {
  getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32 | null>;
}

class LocalNonceManager implements INonceManager {
  public getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32 | null> {
    return Promise.resolve(null);
  }

}

class NonceManager implements INonceManager {
  public getAccountNonce(publicKey: string | PublicKey, tokenId?: Field): Promise<UInt32> {
    throw new Error("Method not implemented.");
  }

}

export {INonceManager, LocalNonceManager, NonceManager};
