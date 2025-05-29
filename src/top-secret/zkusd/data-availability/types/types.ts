export enum WalrusFileType {
  INTENT = 'intent',
  EPOCH = 'epoch',
  METADATA = 'metadata',
}

export interface WalrusFile {
  version: string;
  fileType: WalrusFileType;
}

export enum IntentType {
  CREATE_VAULT = 'create_vault',
  DEPOSIT_COLLATERAL = 'deposit_collateral',
  MINT_ZKUSD = 'mint_zkusd',
  REDEEM_COLLATERAL = 'redeem_collateral',
  BURN_ZKUSD = 'burn_zkusd',
  LIQUIDATE_VAULT = 'liquidate_vault',
  TRANSFER_ZKUSD = 'transfer_zkusd',
}

export enum MapType {
  VAULT = 'vault',
  ZKUSD = 'zkusd',
}

export enum OperationType {
  INSERT = 'insert',
  UPDATE = 'update',
}

export interface IntentFile extends WalrusFile {
  fileType: WalrusFileType.INTENT;
  intentType: IntentType;
  proof: string;
  encryptedNotes: string[];
}

export interface EpochFile extends WalrusFile {
  fileType: WalrusFileType.EPOCH;

  // Timestamp of the epoch end -> from the sequencer
  timestamp: number;

  // Previous epoch information
  previousEpoch: number;
  previousEpochBlobId: string;

  // Epoch identification
  epoch: number;
  startIntentSequence: number; //50
  endIntentSequence: number; //150

  //Vault map information
  previousVaultMapRoot: string;
  previousVaultMapLength: string;

  newVaultMapRoot: string;
  newVaultMapLength: string;

  //ZkUsd map information
  previousZkUsdMapRoot: string;
  previousZkUsdMapLength: string;

  newZkUsdMapRoot: string;
  newZkUsdMapLength: string;

  // System parameters
  previousValidPriceBlockCount: number;
  previousEmergencyStop: boolean;
  previousCollateralRatio: number;
  previousLiquidationBonusRatio: number;
  previousVaultDebtCeiling: bigint;
  previousOraclesHash: string;

  newValidPriceBlockCount: number;
  newEmergencyStop: boolean;
  newCollateralRatio: number;
  newLiquidationBonusRatio: number;
  newVaultDebtCeiling: bigint;
  newOraclesHash: string;

  // Operations in this epoch
  operations: Operation[]; // 78 operations

  // Metadata
  operationCount: number;
}

export interface MetadataFile extends WalrusFile {
  fileType: WalrusFileType.METADATA;

  // Latest epoch file
  latestEpochFileBlobId: string;

  // Current state
  latestEpoch: number;
  latestVaultMapRoot: string; // hex string
  latestVaultMapLength: string; // number of leaves after this epoch
  latestZkUsdMapRoot: string; // hex string
  latestZkUsdMapLength: string; // number of leaves after this epoch
  totalOperations: number;

  // System parameters
  validPriceBlockCount: number;
  emergencyStop: boolean;
  collateralRatio: number;
  liquidationBonusRatio: number;
  vaultDebtCeiling: number;
  oraclesHash: string;

  // Epoch history (most recent first)
  epochs: EpochMetadata[];

  // Integrity information
  continuityProof: {
    epochRootChain: string[]; // hashed roots of last 100 epoches for verification
  };
}

export interface Operation {
  mapType: MapType;
  type: OperationType;

  // Key-value data
  key: string; // hex string (32 bytes)
  value?: string; // hex string (32 bytes) - for inserts
}

export interface EpochMetadata {
  epoch: number;
  vaultMapRoot: string; // hex string
  zkUsdMapRoot: string; // hex string
  vaultMapLength: string; // number of leaves after this epoch
  zkUsdMapLength: string; // number of leaves after this epoch
  timestamp: number;
  operationCount: number;

  // Blob IDs
  epochBlobId: string;

  // For verification
  epochHash: string; // hash of the entire epoch content
  previousEpochHash: string; // for chain integrity
}
