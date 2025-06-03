import Database from 'better-sqlite3';


export interface Entry<T> {
  value: T;
  timestamp: number;
}

interface StringStoreOptions {
  dbPath?: string;
  resetOnInit?: boolean;
}

export interface AppendOnlyStore<T> {
  append(items: T[], timestamp?: number): void;
  read(start?: number, end?: number): Entry<T>[];
  clear(): void;
  close(): void;
}

export class SqlStringStore implements AppendOnlyStore<string> {
  private db: Database.Database;

  constructor(options: StringStoreOptions = {}) {
    const { dbPath = 'stringstore.db', resetOnInit = false } = options;
    this.db = new Database(dbPath);
    this.initialize();

    if (resetOnInit) {
      this.clear();
    }
  }

  private initialize(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `;
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_timestamp ON entries(timestamp);
    `;
    this.db.exec(createTableSQL);
    this.db.exec(createIndexSQL);
  }

  /**
   * Append one or more strings with the same timestamp.
   * @param values Array of strings to store.
   * @param timestamp Optional timestamp (ms since epoch). Defaults to Date.now().
   */
  public append(values: string[], timestamp: number = Date.now()): void {
    const insert = this.db.prepare(
      'INSERT INTO entries (value, timestamp) VALUES (?, ?)'
    );
    const transaction = this.db.transaction((vals: string[]) => {
      for (const val of vals) {
        insert.run(val, timestamp);
      }
    });
    transaction(values);
  }

  /**
   * Read stored strings, optionally filtered by timestamp range.
   * @param start Optional start timestamp (inclusive).
   * @param end Optional end timestamp (inclusive).
   * @returns Array of stored entries.
   */
  public read(start?: number, end?: number): Entry<string>[] {
    let query = 'SELECT id, value, timestamp FROM entries';
    const conditions: string[] = [];
    const params: any[] = [];

    if (start !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(start);
    }

    if (end !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(end);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY timestamp ASC, id ASC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Entry<string>[];
  }

  /**
   * Clear all stored data.
   */
  public clear(): void {
    this.db.exec('DELETE FROM entries;');
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    this.db.close();
  }
}