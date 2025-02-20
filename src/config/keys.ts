import { PrivateKey, PublicKey } from 'o1js';
import { blockchain } from '../mina/networks.js';
import { KeyPair } from '../types/utility.js';
import { OracleWhitelist } from '../system/oracle.js';
import dotenv from 'dotenv';

dotenv.config();

export interface NetworkKeyPairs {
  deployer?: KeyPair;
  protocolAdmin: KeyPair;
  token: KeyPair;
  engine: KeyPair;
  oracles?: [
    Partial<KeyPair> & Pick<KeyPair, 'publicKey'>,
    ...Array<Partial<KeyPair> & Pick<KeyPair, 'publicKey'>>,
  ] & {
    length: typeof OracleWhitelist.MAX_PARTICIPANTS;
  };
  agents?: Record<string, AgentKeys>;
}

export interface ContractKeys {
  token: PublicKey;
  engine: PublicKey;
}

export interface AgentKeys {
  keys: KeyPair;
  vault: KeyPair;
}

function loadDevnetKeys(): NetworkKeyPairs {
  const requiredEnvVars = [
    'DEVNET_DEPLOYER_PRIVATE_KEY',
    'DEVNET_DEPLOYER_PUBLIC_KEY',
    'DEVNET_PROTOCOL_ADMIN_PRIVATE_KEY',
    'DEVNET_PROTOCOL_ADMIN_PUBLIC_KEY',
    'DEVNET_TOKEN_PRIVATE_KEY',
    'DEVNET_TOKEN_PUBLIC_KEY',
    'DEVNET_ENGINE_PRIVATE_KEY',
    'DEVNET_ENGINE_PUBLIC_KEY',
    'DEVNET_ORACLE_1_PUBLIC_KEY',
    'DEVNET_ORACLE_2_PUBLIC_KEY',
    'DEVNET_ORACLE_3_PUBLIC_KEY',
  ];

  requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
      throw new Error(`Environment variable ${envVar} is not set.`);
    }
  });

  const devnetKeys: NetworkKeyPairs = {
    deployer: {
      privateKey: PrivateKey.fromBase58(
        process.env.DEVNET_DEPLOYER_PRIVATE_KEY!
      ),
      publicKey: PublicKey.fromBase58(process.env.DEVNET_DEPLOYER_PUBLIC_KEY!),
    },
    protocolAdmin: {
      privateKey: PrivateKey.fromBase58(
        process.env.DEVNET_PROTOCOL_ADMIN_PRIVATE_KEY!
      ),
      publicKey: PublicKey.fromBase58(
        process.env.DEVNET_PROTOCOL_ADMIN_PUBLIC_KEY!
      ),
    },
    token: {
      privateKey: PrivateKey.fromBase58(process.env.DEVNET_TOKEN_PRIVATE_KEY!),
      publicKey: PublicKey.fromBase58(process.env.DEVNET_TOKEN_PUBLIC_KEY!),
    },
    engine: {
      privateKey: PrivateKey.fromBase58(process.env.DEVNET_ENGINE_PRIVATE_KEY!),
      publicKey: PublicKey.fromBase58(process.env.DEVNET_ENGINE_PUBLIC_KEY!),
    },
    oracles: [
      {
        publicKey: PublicKey.fromBase58(
          process.env.DEVNET_ORACLE_1_PUBLIC_KEY!
        ),
      },
      {
        publicKey: PublicKey.fromBase58(
          process.env.DEVNET_ORACLE_2_PUBLIC_KEY!
        ),
      },
      {
        publicKey: PublicKey.fromBase58(
          process.env.DEVNET_ORACLE_3_PUBLIC_KEY!
        ),
      },
      // Fill remaining oracle slots with empty objects containing only publicKey
      ...Array(OracleWhitelist.MAX_PARTICIPANTS - 3).fill({
        publicKey: PublicKey.fromBase58(
          process.env.DEVNET_ORACLE_DUMMY_PUBLIC_KEY!
        ),
      }),
    ] as [
      Partial<KeyPair> & Pick<KeyPair, 'publicKey'>,
      ...Array<Partial<KeyPair> & Pick<KeyPair, 'publicKey'>>,
    ] & {
      length: typeof OracleWhitelist.MAX_PARTICIPANTS;
    },
  };

  return devnetKeys;
}

const lightnetAgentKeys: Record<string, AgentKeys> = {
  alice: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKEkwS2sbJB8SgGmZXCGMyxSu52jde9ZXRKNb2MtvbK7eNoZbNUh'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qictqXwJ8SXfHgifQsSn65YndG3AUqxnuG7dtZRsKcvBQDanCU3q'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKEkfMVK6s2Rs6YnbeMvw9SvN5bSvZ8TQ93JMj55FtyKC7CmLhNy'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qoJqGx3WitVCiL38RKJQ175xvtHUuyEKE2MiXbv8xkLrDrodeYfq'
      ),
    },
  },
  bob: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKE1xWEyomwTCdMm1Aroc1SMUjw32KmkwmPrmjiYJGZDjVjwjwe9'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qpf9cqF4U887MyNSBgqVPBshhtcE6bD2vJMMbX9V4e5odz8Jsuqm'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKEVTTsxRE3eviFgQ3Z57Ge7TKgxcdouuNcKVFXidWpekp5jZzjw'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qrdiErKhPG4by5bWRkCnWof5xF5tmUXXW4Qgpri5Ge3DSbCkAkdZ'
      ),
    },
  },
  charlie: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKEPYvqhBWe5kLFhtJJz9HxPK3j9Hw1AvdzNjQAYUBQvTH9GAB4b'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qm6HBx2MEcYYiJFFYT4NGb2LxGa1SACCPyg6aPfGk145K5fbeBUQ'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKE42Z93wxhgGqgv7Ukhwu9Drm9xXbLnJ9AihSepTHdCgVkJtxqZ'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qqwDNcWaAkBbuiQ4x2dBp1BGgQ2Nwx4ehtAYBEa6vrojjBrM8YHj'
      ),
    },
  },
  dave: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKFKZA1MGJJdFMaaV8zb5U727ScGdkkHgEzm7ZncqJwvWnZ7LZN4'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qkyRcD5Ft9dwoHaGPmjoAiy4jSREYiKr4VZH5becFDJykREGNEiM'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKFX7cexV3DD2E3wJdFGxmqc2cCdCGbSKjm34svM4XYtcmhZtrUa'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qopcrUjQrcTcv2kCxzYpBSjJjV7YuSp4W6VWXSvErhSFWEUxx5dx'
      ),
    },
  },
  eve: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKEpMiNACkRt6aBWrBvggwijG8k3pmDHXW6G37UqpXUSQNDw5s6c'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qqDZEcmc29ovde8E1xmpFimjrFd6nxgdGzyh2QCM1ZooZKyyV9Sv'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKFJkuqfqnjdNdGpShZq1cX39Tq3cwYt574w2LUCtEsfHQ44LH1T'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qoSLRfea4ngNqk9w8XxBiBZ72mWKe6321iQ71ozPVfxRGFbQ31VS'
      ),
    },
  },
  fred: {
    keys: {
      privateKey: PrivateKey.fromBase58(
        'EKF3d28HmasSDmEwDicsH1LmHBhad2YmqAnHcsYMPdjZ9XMgFrAx'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qrnQQYwQirzXsfBS4x2qHZiVuB79eFBELQpqhpN1nr1FGVBavD8h'
      ),
    },
    vault: {
      privateKey: PrivateKey.fromBase58(
        'EKEnMbyyCGFodfGU8udKsFHWgcEFGrDnCsmx4L1vVajeG3XV21ij'
      ),
      publicKey: PublicKey.fromBase58(
        'B62qoYAXnb1tKmSDQKstvZasTsgSyPpeUFeo745njPnLm4WFYtmi1oi'
      ),
    },
  },
};

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
const lightnetKeys: NetworkKeyPairs = {
  ...localKeys,
  agents: lightnetAgentKeys,
};

export function getNetworkKeys(network: blockchain): NetworkKeyPairs {
  switch (network) {
    case 'local':
      return localKeys;
    case 'lightnet':
      return lightnetKeys;
    case 'devnet':
      return loadDevnetKeys();
    default:
      throw new Error(`Network ${network} not supported`);
  }
}

export function getContractKeys(network: blockchain): ContractKeys {
  switch (network) {
    case 'local':
      return {
        token: localKeys.token.publicKey,
        engine: localKeys.engine.publicKey,
      };
    case 'lightnet':
      return {
        token: lightnetKeys.token.publicKey,
        engine: lightnetKeys.engine.publicKey,
      };
    case 'devnet':
      return {
        token: PublicKey.fromBase58(
          'B62qpc3XFBoXXN1XmKeb2YsquXgaoxPBdrDLLMC4oVBdjFjEMsDYQB7'
        ),
        engine: PublicKey.fromBase58(
          'B62qqwWtv1M9YdgcV5Z5YcxbZxD2X9qPZVpV4GSQPu4PEPn4gfLUFFZ'
        ),
      };
    default:
      throw new Error(`Network ${network} not supported`);
  }
}
