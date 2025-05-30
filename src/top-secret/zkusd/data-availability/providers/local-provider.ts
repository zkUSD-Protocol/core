import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { StorageMetadata, StorageProvider } from './storage-provider.js';
import { FileType } from '../types/types.js';

export class LocalProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(options?: { baseDir?: string }) {
    // Use provided base directory or create a temp directory
    this.baseDir = options?.baseDir ?? path.join(os.tmpdir(), 'zkusd-da-local');

    this.ensureDirectoryExists();
  }

  async store(data: string, metadata?: StorageMetadata): Promise<string> {
    try {
      // Generate a unique blob ID
      const blobId = this.generateBlobId();
      const filePath = this.getBlobPath(blobId, metadata?.fileType);

      // Ensure the directory exists
      await this.ensureDirectoryExists();

      if (metadata?.fileType === FileType.METADATA) {
        //remove the current files in the metadata directory
        const metadataDir = path.join(this.baseDir, 'metadata');
        const files = await fs.readdir(metadataDir);
        for (const file of files) {
          await fs.unlink(path.join(metadataDir, file));
        }
      }

      // Parse and re-stringify with formatting for better readability
      const parsedData = JSON.parse(data);
      const formattedData = JSON.stringify(parsedData, null, 2);

      // Store the formatted data as JSON file
      await fs.writeFile(filePath, formattedData, 'utf-8');

      return blobId;
    } catch (error) {
      throw new Error(
        `Local storage failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async retrieve(blobId: string, metadata?: StorageMetadata): Promise<string> {
    try {
      const filePath = this.getBlobPath(blobId, metadata?.fileType);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`Blob not found: ${blobId}`);
      }

      // Read and return the data
      const data = await fs.readFile(filePath, 'utf-8');
      return data;
    } catch (error) {
      throw new Error(
        `Local retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getUrl(blobId: string, metadata?: StorageMetadata): Promise<string> {
    // For local provider, return file path as URL
    const filePath = this.getBlobPath(blobId, metadata?.fileType);
    return `file://${filePath}`;
  }

  // Local-specific helper methods
  async exists(blobId: string): Promise<boolean> {
    try {
      const filePath = this.getBlobPath(blobId);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listBlobs(): Promise<string[]> {
    try {
      await this.ensureDirectoryExists();
      const files = await fs.readdir(this.baseDir);
      return files
        .filter(
          (file) => file.endsWith('.json') && !file.endsWith('.metadata.json')
        )
        .map((file) => path.basename(file, '.json'));
    } catch {
      return [];
    }
  }

  async deleteBlob(blobId: string): Promise<void> {
    try {
      const filePath = this.getBlobPath(blobId);

      // Delete main file
      try {
        await fs.unlink(filePath);
      } catch {
        // File might not exist, that's ok
      }

      console.log(`🗑️  Deleted locally: ${blobId}`);
    } catch (error) {
      throw new Error(
        `Local deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async cleanup(): Promise<void> {
    try {
      // Remove the entire directory and all its contents
      await fs.rm(this.baseDir, { recursive: true, force: true });

      // Recreate the directory structure
      await this.ensureDirectoryExists();
    } catch (error) {
      console.warn(`Failed to clear local storage: ${error}`);
    }
  }
  getStorageInfo(): { baseDir: string; blobCount: Promise<number> } {
    return {
      baseDir: this.baseDir,
      blobCount: this.listBlobs().then((blobs) => blobs.length),
    };
  }

  private generateBlobId(): string {
    // Generate a UUID-based blob ID
    return randomUUID().replace(/-/g, '');
  }

  private getBlobPath(blobId: string, fileType?: FileType): string {
    return path.join(this.baseDir, `${fileType ?? ''}`, `${blobId}.json`);
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'block'), { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'metadata'), { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'checkpoint'), {
        recursive: true,
      });
    } catch (error) {
      // Directory might already exist, that's ok
    }
  }
}
