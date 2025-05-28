enum WalrusFileType {
  INTENT = 'intent',
  EPOCH = 'epoch',
  METADATA = 'metadata',
}

interface WalrusFile {
  version: string;
  fileType: WalrusFileType;
  timestamp: number;
  checksum: string; // SHA-256 hash for integrity
}

enum IntentType {
  CREATE_VAULT = 'create_vault',
  DEPOSIT_COLLATERAL = 'deposit_collateral',
  MINT_ZKUSD = 'mint_zkusd',
  REDEEM_COLLATERAL = 'redeem_collateral',
  BURN_ZKUSD = 'burn_zkusd',
  LIQUIDATE_VAULT = 'liquidate_vault',
  TRANSFER_ZKUSD = 'transfer_zkusd',
}

enum MapType {
  VAULT = 'vault',
  ZKUSD = 'zkusd',
}

enum OperationType {
  INSERT = 'insert',
  UPDATE = 'update',
}

interface IntentFile extends WalrusFile {
  fileType: WalrusFileType.INTENT;
  intentType: IntentType;
  proof: string;
  encryptedNotes: string[];
}

interface EpochFile extends WalrusFile {
  fileType: WalrusFileType.EPOCH;

  // Epoch identification
  epoch: number;
  startSequence: number;
  endSequence: number;

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

  // Operations in this epoch
  operations: Operation[];

  // Metadata
  operationCounts: {
    inserts: number;
    updates: number;
  };
}

interface MetadataFile extends WalrusFile {
  fileType: WalrusFileType.METADATA;

  // Current state
  latestEpoch: number;
  latestVaultMapRoot: string; // hex string
  latestZkUsdMapRoot: string; // hex string
  totalOperations: number;

  // Epoch history (most recent first)
  epochs: EpochMetadata[];

  // Network information
  networkInfo: {
    chainId: string;
    genesisRoot: string;
    genesisTimestamp: number;
  };

  // Integrity information
  continuityProof: {
    epochRootChain: string[]; // roots of last 100 epoches for verification
  };
}

interface Operation {
  // Operation identificationx
  sequence: number; // unique within epoch
  mapType: MapType;
  type: OperationType;

  // Key-value data
  key: string; // hex string (32 bytes)
  value?: string; // hex string (32 bytes) - for inserts
  oldValue?: string; // hex string (32 bytes) - for updates
  newValue?: string; // hex string (32 bytes) - for updates
}

interface EpochMetadata {
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
