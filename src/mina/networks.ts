import { blockchain } from '../types/utility.js';

export type { MinaNetwork, blockchain };

export { networks, Local, Lightnet, validPriceBlockCount, Devnet };
interface MinaNetwork {
  mina: string[];
  archive: string[];
  chainId: blockchain;
  name?: string;
  lightnetAccountManager?: string;
  explorerAccountUrl?: string;
  explorerTransactionUrl?: string;
}

const validPriceBlockCount: Record<blockchain, number> = {
  local: 1,
  lightnet: 10,
  devnet: 5, // TODO isn't it too high?
  mainnet: 2,
  zeko: 2,
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

const Devnet: MinaNetwork = {
  mina: ['https://api.minascan.io/node/devnet/v1/graphql'],
  archive: ['https://api.minascan.io/archive/devnet/v1/graphql'],
  explorerAccountUrl: 'https://minascan.io/devnet/account/',
  explorerTransactionUrl: 'https://minascan.io/devnet/tx/',
  chainId: 'devnet',
  name: 'Devnet',
};

const networks: MinaNetwork[] = [Local, Lightnet, Devnet];
