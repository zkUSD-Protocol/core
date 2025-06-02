import { SerializableMapData } from '../../data/maps/serializable-indexed-map';
import { StateRoots } from '../../validator/block-state';

export enum BlobType {
  INTENT = 'intent',
  BLOCK = 'block',
  CHECKPOINT = 'checkpoint',
}

export interface Blob {
  version: string;
  blobType: BlobType;
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

export interface IntentBlob extends Blob {
  blobType: BlobType.INTENT;
  intentType: IntentType;
  proof: string;
  encryptedNotes: string[];
}

export interface BlockBlob extends Blob {
  blobType: BlobType.BLOCK;

  // Block identification
  blockData: BlockData;

  // Block History Metadata
  blockMetadata: BlockMetadata;
}

export interface CheckpointBlob extends Blob {
  blobType: BlobType.CHECKPOINT;

  // Maps data
  vaultMapData: SerializableMapData;
  zkUsdMapData: SerializableMapData;

  // Checkpoint metadata
  block: number;

  // Roots
  vaultMapRoot: string; // hex string
  zkUsdMapRoot: string; // hex string

  //Full block history
  blocks: BlockData[];
}

export interface BlockData {
  block: number;
  vaultMapRoot: string;
  zkUsdMapRoot: string;
  operations: Operation[];
  operationCount: number;
}

export interface BlockMetadata {
  checkpointBlobId: string;
  checkpointBlock: number;
  sinceCheckpointBlockHeaders: BlockHeader[];
}

export interface Operation {
  mapType: MapType;
  type: OperationType;

  // Key-value data
  key: string; // hex string (32 bytes)
  value: string; // hex string (32 bytes) - for inserts
}

export interface BlockHeader {
  block: number;
  vaultMapRoot: string; // hex string
  zkUsdMapRoot: string; // hex string
  // timestamp: number;
  operationCount: number;

  // Blob IDs - ephemeral as older blobs are deleted after archiving in checkpoint
  // We store this prior to archiving in checkpoint to allow for easier blob
  blockBlobId: string;
}
