import { blockchain } from 'zkcloudworker';

interface MinaNetwork {
  mina: string[];
  archive: string[];
  chainId: blockchain;
  name?: string;
  lightnetAccountManager?: string;
  explorerAccountUrl?: string;
  explorerTransactionUrl?: string;
}

export const validPriceBlockCount: Record<string, number> = {
  local: 1,
  lightnet: 10,
  devnet: 30,
};

const Local: MinaNetwork = {
  mina: [],
  archive: [],
  chainId: 'local',
};

const Lightnet: MinaNetwork = {
  mina: ['http://localhost:8080/graphql'],
  archive: ['http://localhost:8282'],
  lightnetAccountManager: 'http://localhost:8181',
  chainId: 'lightnet',
  name: 'Lightnet',
};

const networks: MinaNetwork[] = [Local, Lightnet];

export { networks, MinaNetwork, blockchain, Local, Lightnet };
