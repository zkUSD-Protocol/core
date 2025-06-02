import { BlobType } from '../types/types';

export interface StorageProvider {
  store(data: string, metadata?: StorageMetadata): Promise<string>;
  retrieve(blobId: string, metadata?: StorageMetadata): Promise<string>;
  cleanAfterCheckpoint(checkpointBlobId: string): Promise<void>; // For cost optimization on WAL

  cleanup?(): Promise<void>;
}

export interface StorageMetadata {
  numEpochs?: number;
  address?: string;
  blobType?: BlobType;
}
