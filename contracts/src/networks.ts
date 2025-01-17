import { blockchain } from 'zkcloudworker';

interface MinaNetwork {
  mina: string[];
  archive: string[];
  chainId: blockchain;
  name?: string;
  lightnetAccountManager?: string;
  explorerAccountUrl?: string;
  explorerTransactionUrl?: string;
  validPriceBlockCount?: number;
}

const Local: MinaNetwork = {
  mina: [],
  archive: [],
  chainId: 'local',
  validPriceBlockCount: 1,
};

const Lightnet: MinaNetwork = {
  mina: ['http://localhost:8080/graphql'],
  archive: ['http://localhost:8282'],
  lightnetAccountManager: 'http://localhost:8181',
  chainId: 'lightnet',
  name: 'Lightnet',
  validPriceBlockCount: 10,
};

const networks: MinaNetwork[] = [Local, Lightnet];

export { networks, MinaNetwork, blockchain, Local, Lightnet };
