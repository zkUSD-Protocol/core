import { PrivateKey, PublicKey } from 'o1js';
import { blockchain } from '../mina/networks.js';
import { KeyPair, OracleWhitelist } from '../types.js';

export interface NetworkKeyPairs {
  protocolAdmin: KeyPair;
  token: KeyPair;
  engine: KeyPair;
  oracles?: [KeyPair, ...KeyPair[]] & {
    length: typeof OracleWhitelist.MAX_PARTICIPANTS;
  };
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
  oracles: [
    {
      privateKey: PrivateKey.fromBase58(
        'EKDzcJepiGrakn3nnYPhKC5U1iNsCTa6kVsgbJFct6CNMW3X18Mt'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qojMrLLkzcGHYahq9sgNwxFZqx3kj7A6nEGD3narjQfH4aRsoswH'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKFTPcytsah99CmD3RuoY6GwcQFeVRYcRJZ47vXCXv6XEvPub3NR'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qnCmnH19eU8vchV9nm7XGaF7LHWA1rbEGBmtQ1CPW2nXNrRoyce3'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKFZDT2Mdy8pMu12rCyizzf7QFhkAptjF1wEVFFgEBmqLisPV8g4'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qpepttp2pkGRhYtmzxJQcxwFyzFQe5SsDkPA6ceqz2NLcibzFbC8'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKDyZRwKE2UGSt3V5JquudPLWwKZpTPiPe2Mde8RTQfTW1t6mZhc'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qpMxqtCmDLQ3XbUUP5HgbGtDqB1eYbJrzRGP241RqxZQKgB9MyPj'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKFGAGEVSy1cWNUPa8iXXCZPjJn5aBkHg99zxvGN7wPayd1Eh6MQ'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qo7zh7stHaD374tn1VTmRohHoCr8KSa2Y2qdUtqaU3tKawjSntxZ'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKDvYppDfiPgPaN1kpUiQYC4i3RLoAHbfiZm23UThkgnjPZmq6zr'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qiziupkNowY2LrPmTCWvgvkJTyXVRFBeZNUDkF1pzTVSqtxg1Y4c'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKEhjcHehmb3sBQbCbSDJm5gKdkDSvtXapkvJ5Y3nn4QuvBaMG95'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qq9a6Lvs1mbW54DAF9EYrpURHu1yJr6VQhr9ZJFwbjeuA7E1GcjN'
      ),
    },
    {
      privateKey: PrivateKey.fromBase58(
        'EKE1sCwW1WDecaMkCVNH4nevCNi8DCkAkEJyLp3ZoY5Tig5t2EPA'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qkB9Xz5sw77rJi9bbum8Zq7MeSqV3u4ihuP4cVkZsKkpfPRsskMU'
      ),
    },
  ],
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
