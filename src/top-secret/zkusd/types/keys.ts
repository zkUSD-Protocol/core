import { PrivateKey, Field, Poseidon, PublicKey, Struct } from 'o1js';

export class PaymentAddress extends Struct({
  viewingPublicKey: PublicKey,
  spendingPublicKey: PublicKey,
}) {
  // Convert to string format for sharing
  toString(): string {
    return `zkusd:${this.viewingPublicKey.toBase58()}:${this.spendingPublicKey.toBase58()}`;
  }

  // Parse from string
  static fromString(addressString: string): PaymentAddress {
    const parts = addressString.split(':');
    if (parts.length !== 3 || parts[0] !== 'zkusd') {
      throw new Error('Invalid payment address format');
    }

    return new PaymentAddress({
      viewingPublicKey: PublicKey.fromBase58(parts[1]),
      spendingPublicKey: PublicKey.fromBase58(parts[2]),
    });
  }
}

export class Keys extends Struct({
  paymentAddress: PaymentAddress,
  spendingKey: PrivateKey,
  viewingKey: PrivateKey,
  nullifierKey: Field,
}) {
  static NULLIFIER_KEY_TAG = '1';
  static VIEWING_KEY_TAG = '2';

  static fromPrivateKey(sk: PrivateKey): Keys {
    return new Keys({
      paymentAddress: new PaymentAddress({
        viewingPublicKey: this.deriveViewingKey(sk).toPublicKey(),
        spendingPublicKey: sk.toPublicKey(),
      }),
      spendingKey: sk,
      viewingKey: this.deriveViewingKey(sk),
      nullifierKey: this.deriveNullifierKey(sk),
    });
  }

  static deriveNullifierKey(sk: PrivateKey): Field {
    const skField = Field.from(sk.toBigInt());
    const tag = Poseidon.hash([Field.from(Keys.NULLIFIER_KEY_TAG)]);
    return Poseidon.hash([tag, skField]);
  }

  static deriveViewingKey(sk: PrivateKey): PrivateKey {
    const viewingKeyField = Poseidon.hash([
      ...sk.toFields(),
      Field.from(Keys.VIEWING_KEY_TAG),
    ]);

    return PrivateKey.fromBits(viewingKeyField.toBits().slice(0, 255));
  }
}
