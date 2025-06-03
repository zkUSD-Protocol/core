import { deserializeEncryptedNote, EncryptedNote, serializeEncryptedNote } from '../data/note.js';
import { SqlStringStore, Entry } from './append-only-store.js';
export interface EncryptedNoteStoreOptions {
  dbPath?: string;
  resetOnInit?: boolean;
}

export class EncryptedNoteStore {
  private store: SqlStringStore;

  constructor(options: EncryptedNoteStoreOptions = {}) {
    this.store = new SqlStringStore({
      dbPath: options.dbPath ?? 'encrypted-notes.db',
      resetOnInit: options.resetOnInit ?? false,
    });
  }

  /**
   * Append one or more EncryptedNotes with the same timestamp.
   * @param notes Array of EncryptedNote objects.
   * @param timestamp Optional timestamp (ms since epoch).
   */
  public append(notes: EncryptedNote[], timestamp?: number): void {
    const strings = notes.map((note) =>
      JSON.stringify(serializeEncryptedNote(note))
    );
    this.store.append(strings, timestamp);
  }

  /**
   * Read stored EncryptedNotes within optional timestamp range.
   * @param start Optional start timestamp.
   * @param end Optional end timestamp.
   * @returns Array of EncryptedNote objects.
   */
  public read(start?: number, end?: number): Entry<EncryptedNote>[] {
    const entries = this.store.read(start, end);
    return entries.map((entry: Entry<string>) =>
      ({
        value: deserializeEncryptedNote(JSON.parse(entry.value)),
        timestamp: entry.timestamp,
      })
    );
  }

  /**
   * Clear all notes.
   */
  public clear(): void {
    this.store.clear();
  }

  /**
   * Close the database.
   */
  public close(): void {
    this.store.close();
  }
}