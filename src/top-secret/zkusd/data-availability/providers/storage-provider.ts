import { FileType } from '../types/types';

export interface StorageProvider {
  store(data: string, metadata?: StorageMetadata): Promise<string>;
  retrieve(blobId: string, metadata?: StorageMetadata): Promise<string>;
  getUrl(blobId: string, metadata?: StorageMetadata): Promise<string>;

  cleanup?(): Promise<void>;
}

export interface StorageMetadata {
  numBlocks?: number;
  address?: string;
  fileType?: FileType;
}
