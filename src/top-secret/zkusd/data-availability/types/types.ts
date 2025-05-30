import { SerializableMapData } from '../../data/maps/serializable-indexed-map';
import { StateRoots } from '../../validator/block-state';

export enum FileType {
  INTENT = 'intent',
  EPOCH = 'block',
  METADATA = 'metadata',
  CHECKPOINT = 'checkpoint',
}

export interface File {
  version: string;
  fileType: FileType;
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
  SET = 'set',
}

export interface IntentFile extends File {
  fileType: FileType.INTENT;
  intentType: IntentType;
  proof: string;
  encryptedNotes: string[];
}

export interface BlockFile extends File {
  fileType: FileType.EPOCH;

  // Timestamp of the block end -> from the sequencer
  // timestamp: number;

  // Previous block information
  previousBlock: number;
  previousBlockBlobId: string;

  // Block identification
  block: number;

  //Vault map information
  previousVaultMapRoot: string;
  newVaultMapRoot: string;

  //ZkUsd map information
  previousZkUsdMapRoot: string;
  newZkUsdMapRoot: string;

  // Operations in this block
  operations: Operation[]; // 78 operations

  // Metadata
  operationCount: number;
}

export interface MetadataFile extends File {
  fileType: FileType.METADATA;

  // Latest block file
  latestBlockFileBlobId: string;

  // Latest checkpoint file
  latestCheckpointFileBlobId: string;
  latestCheckpointBlock: number;

  // Current state
  latestBlock: number;
  latestVaultMapRoot: string; // hex string
  latestZkUsdMapRoot: string; // hex string
  totalOperations: number;

  // Block history (most recent first)
  blocks: BlockMetadata[];

  // Integrity information
  continuityProof: {
    blockRootChain: string[]; // hashed roots of last 100 blockes for verification
  };
}

export interface CheckpointFile extends File {
  fileType: FileType.CHECKPOINT;

  // Maps data
  vaultMapData: SerializableMapData;
  zkUsdMapData: SerializableMapData;

  // Checkpoint metadata
  block: number;
  blockBlobId: string;
  checkpointId: string;

  // Roots
  vaultMapRoot: string; // hex string
  zkUsdMapRoot: string; // hex string
}

export interface Operation {
  mapType: MapType;
  type: OperationType;

  // Key-value data
  key: string; // hex string (32 bytes)
  value: string; // hex string (32 bytes) - for inserts
}

export interface BlockMetadata {
  block: number;
  vaultMapRoot: string; // hex string
  zkUsdMapRoot: string; // hex string
  // timestamp: number;
  operationCount: number;

  // Blob IDs
  blockBlobId: string;

  // For verification
  blockHash: string; // hash of the entire block content
  previousBlockHash: string; // for chain integrity
}
