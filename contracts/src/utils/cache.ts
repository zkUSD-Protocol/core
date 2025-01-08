import { readFileSync, writeFileSync } from 'fs';
import { CacheHeader, Cache } from 'o1js';

export class FileSystemCache implements Cache {
  constructor(public debug: boolean = false, public directory = 'cache') {}

  read(header: CacheHeader): Uint8Array | undefined {
    console.log('Reading from cache', header.persistentId);
    try {
      return new Uint8Array(
        readFileSync(this.directory + '/' + header.persistentId)
      );
    } catch (e) {
      return undefined;
    }
  }
  write(header: CacheHeader, value: Uint8Array): void {
    console.log('Writing to cache', header.persistentId);
    writeFileSync(this.directory + '/' + header.persistentId, value);
  }
  canWrite = true;
}
