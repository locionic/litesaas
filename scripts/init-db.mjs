import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL || 'data/app.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(DB_PATH, { timeout: 10000 });

// Apply Production PRAGMAs
sqlite.pragma('page_size = 4096');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('cache_size = -64000');
sqlite.pragma('temp_store = MEMORY');

// Initialize database schema tables if not exist
const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    current_period_end INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

sqlite.exec(DDL);

/**
 * Fail loudly when the file on disk does not match the schema above.
 *
 * CREATE TABLE IF NOT EXISTS creates a *missing* table and silently ignores an
 * existing one, so it can never add a column to one. This is the only schema
 * step the container runs — `db:push` never happens in Docker — so a
 * bind-mounted data/app.db carried over from before a schema change used to
 * start the app cleanly and then fail on the first query for the missing column:
 * a Next error page, and an empty container log, because `next start` does not
 * print server render errors. Anyone who follows the README's `npm run db:push`
 * locally and then deploys Docker hits exactly that, with nothing connecting the
 * two ends.
 *
 * The expectation is read out of the DDL above rather than written out a second
 * time, so adding a column to it adds the requirement here for free.
 */
const drift = [];
for (const [, table, body] of DDL.matchAll(
  /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g
)) {
  const have = new Set(
    sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  );
  const missing = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter((column) => !have.has(column));

  if (missing.length) drift.push(`${table}(${missing.join(', ')})`);
}

if (drift.length) {
  console.error(
    `LiteSaaS: ${DB_PATH} is missing columns the app needs — ${drift.join('; ')}\n` +
      'CREATE TABLE IF NOT EXISTS cannot add a column to a table that already exists, and this\n' +
      'container is the only place the schema is applied. Bring the file up to date, or delete it to\n' +
      'have it created fresh. If it came from a Litestream replica, the backup is the stale copy.'
  );
  process.exit(1);
}

console.log('LiteSaaS: Database initialized successfully at', DB_PATH);
sqlite.close();