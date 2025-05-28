import { ZkUsdState } from './state.js';
import { VaultMap } from './maps/vault-map.js';
import { ZkUsdMap } from './maps/zkusd-map.js';

export type EpochState = {
  state: ZkUsdState;
  vaultMap: VaultMap;
  zkUsdMap: ZkUsdMap;
};
