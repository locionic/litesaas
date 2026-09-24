import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL || 'data/app.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Global singleton pattern for development hot-reloading in Next.js
 */
declare global {
  // eslint-disable-next-line no-var
  var __sqliteDbInstance: Database.Database | undefined;
}

function createSqliteConnection(): Database.Database {
  const sqlite = new Database(DB_PATH, {
    timeout: 5000,
    verbose: process.env.NODE_ENV === 'development' ? undefined : undefined,
  });

  /**
   * BATTLE-TESTED SQLITE PRODUCTION PRAGMAS
   * Reference: https://locionic.com/en/blog/sqlite-wal-mode-production-concurrency
   *
   * 1. page_size MUST be executed first before WAL/tables on fresh databases.
   * 2. WAL mode allows concurrent non-blocking readers alongside an active writer.
   * 3. NORMAL synchronous skips excessive OS fsync() operations while remaining ACID crash-safe in WAL mode.
   * 4. busy_timeout = 5000 gives connection a 5-second retry window before throwing SQLITE_BUSY.
   * 5. foreign_keys = ON enforces relational referential integrity.
   */
  sqlite.pragma('page_size = 4096');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('cache_size = -64000'); // ~64MB cache in RAM
  sqlite.pragma('temp_store = MEMORY');

  return sqlite;
}

const sqliteInstance = global.__sqliteDbInstance || createSqliteConnection();

if (process.env.NODE_ENV !== 'production') {
  global.__sqliteDbInstance = sqliteInstance;
}

export const db = drizzle(sqliteInstance, { schema });
export { sqliteInstance as rawSqlite };
