type blockchain = 'local' | 'lightnet';

interface MinaNetwork {
  mina: string[];
  archive: string[];
  chainId: blockchain;
  name?: string;
  accountManager?: string;
  explorerAccountUrl?: string;
  explorerTransactionUrl?: string;
}

const Local: MinaNetwork = {
  mina: [],
  archive: [],
  chainId: 'local',
};

const Lightnet: MinaNetwork = {
  mina: ['http://localhost:8080/graphql'],
  archive: ['http://localhost:8282'],
  accountManager: 'http://localhost:8181',
  chainId: 'lightnet',
  name: 'Lightnet',
};

const networks: MinaNetwork[] = [Local, Lightnet];

export { networks, MinaNetwork, blockchain, Local, Lightnet };
