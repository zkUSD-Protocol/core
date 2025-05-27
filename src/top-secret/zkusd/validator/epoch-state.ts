import { VaultMap } from "../data/maps/vault-map.js";
import { ZkUsdMap } from "../data/maps/zkusd-map.js";
import { Field } from "o1js";
import { UInt32, UInt64, Bool, UInt8 } from "o1js";
import { EpochStateRoots } from "./sequencer-interface.js";

export type SystemParams = {
    validPriceBlockCount: UInt8,
    emergencyStop: Bool,
    collateralRatio: UInt8,
    liquidationBonusRatio: UInt8,
    vaultDebtCeiling: UInt64,
    oraclesHash: Field,
}

export class FullEpochState {
  epochIndex: number;
  blockNumber: UInt32;
  systemParams: SystemParams;
  vaultMap: VaultMap;
  zkUsdMap: ZkUsdMap;

  // to commitment
  roots(): EpochStateRoots {
    return { 
        vaultMapRoot: this.vaultMap.root,
        zkUsdMapRoot: this.zkUsdMap.root
    };
}

}