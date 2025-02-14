import { blockchain } from '../types/utility.js';

export type { MinaNetwork, blockchain };

export { networks, Local, Lightnet, validPriceBlockCount };
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
  devnet: 30, // TODO isn't it too high?
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

const networks: MinaNetwork[] = [Local, Lightnet];
