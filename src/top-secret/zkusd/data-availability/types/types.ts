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

  //Vault map information
  previousVaultMapRoot: string;
  newVaultMapRoot: string;

  //ZkUsd map information
  previousZkUsdMapRoot: string;
  newZkUsdMapRoot: string;

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
  latestZkUsdMapRoot: string; // hex string
  totalOperations: number;

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
  timestamp: number;
  operationCount: number;

  // Blob IDs
  epochBlobId: string;

  // For verification
  epochHash: string; // hash of the entire epoch content
  previousEpochHash: string; // for chain integrity
}
