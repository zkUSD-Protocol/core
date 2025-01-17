import { PrivateKey, PublicKey } from 'o1js';
import { blockchain } from '../networks.js';
import { KeyPair } from '../types.js';

export interface NetworkKeyPairs {
  protocolAdmin: KeyPair;
  oracleFundsTracker: KeyPair;
  token: KeyPair;
  engine: KeyPair;
}

const localKeys: NetworkKeyPairs = {
  protocolAdmin: {
    privateKey: PrivateKey.fromBase58(
      'EKFUUqHJ4d7Q78c6UYHrdNL5j4xr7QnQFtxWWSM7f1idttzJ5TPH'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qpQzmXmB3euvH3U5sfckNicA6zm7dDYSajXJEEVk5NMAtXzeefgu'
    ),
  },
  oracleFundsTracker: {
    privateKey: PrivateKey.fromBase58(
      'EKEvEeJQqe1e6TFVYsvMpGeJAXtSPNmCrHDWSWHS1Swum8iuTnq9'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qmApLja1zB4GwBLB9Xm1c6Fjc1PxgfCNa9z12wQorHUqZbaiKnym'
    ),
  },
  token: {
    privateKey: PrivateKey.fromBase58(
      'EKDveJ7bFB2SEFU52rgob94xa9NV5fVwarpDKGSQ6TPkmtb9MNd9'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qry2wngUSGZqQn9erfnA9rZPn4cMbDG1XPasGdK1EtKQAxmgjDtt'
    ),
  },
  engine: {
    privateKey: PrivateKey.fromBase58(
      'EKEfFkTEhZZi1UrPHKAmSZadmxx16rP8aopMm5XHbyDM96M9kXzD'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qkwLvZ6e5NzRgQwkTaA9m88fTUZLHmpwvmCQEqbp5KcAAfqFAaf9'
    ),
  },
};

// For now, using same keys for lightnet
const lightnetKeys: NetworkKeyPairs = localKeys;

export function getNetworkKeys(network: blockchain): NetworkKeyPairs {
  switch (network) {
    case 'local':
      return localKeys;
    case 'lightnet':
      return lightnetKeys;
    default:
      throw new Error(`Network ${network} not supported`);
  }
}
