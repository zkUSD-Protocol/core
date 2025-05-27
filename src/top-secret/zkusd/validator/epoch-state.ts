import { ZkUsdState } from "../data/state.js";
import { VaultMap } from "../data/vault-map.js";
import { ZkUsdMap } from "../data/zkusd-map.js";

export type EpochState = {
    state: ZkUsdState;
    vaultMap: VaultMap;
    zkUsdMap: ZkUsdMap;
}