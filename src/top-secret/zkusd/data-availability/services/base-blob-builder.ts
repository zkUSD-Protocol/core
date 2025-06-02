import { Blob, BlobType } from '../types/types.js';

export abstract class BaseBlobBuilder<T extends Blob> {
  protected file: Partial<T> = {};

  protected initializeBlob(blobType: BlobType, version: string): this {
    this.file = {
      ...this.file,
      version,
      blobType,
    } as Partial<T>;
    return this;
  }

  build(): T {
    this.validateCompleteness();
    return this.file as T;
  }

  protected validateCompleteness(): void {
    const required = this.getRequiredFields();
    for (const field of required) {
      if (!(field in this.file)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  protected abstract getRequiredFields(): string[];
}
