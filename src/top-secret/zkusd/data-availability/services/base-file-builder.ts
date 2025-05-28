import { WalrusFile, WalrusFileType } from '../types/types.js';

export abstract class BaseFileBuilder<T extends WalrusFile> {
  protected file: Partial<T> = {};

  protected initializeFile(fileType: WalrusFileType, version: string): this {
    this.file = {
      ...this.file,
      version,
      fileType,
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
