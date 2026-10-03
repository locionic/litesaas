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
    lemon_nonce TEXT,
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
 *
 * The declarations come back whole rather than as bare names, because the
 * migration below needs each column's type to build the ALTER.
 */
function findDrift() {
  const drift = new Map();
  let inspected = 0;
  for (const [, table, body] of DDL.matchAll(
    /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g
  )) {
    inspected++;
    const have = new Set(
      sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
    );
    const missing = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(line))
      .filter((line) => !have.has(line.split(/\s+/)[0]));

    if (missing.length) drift.set(table, missing);
  }
  return { drift, inspected };
}

const nameOf = (declaration) => declaration.split(/\s+/)[0];

let { drift, inspected } = findDrift();

/**
 * Refuse to certify a file the loop above did not actually look at.
 *
 * The expectations are read out of the DDL so they cannot drift from it, which
 * makes that DDL the check's own weak link: the parser is tied to the exact
 * layout above (name, then a newline, then whitespace, then the closing paren
 * on its own line). Reformat it — glue the `);` onto the last column, or
 * indent the tables — and the expression matches nothing, `drift` stays empty
 * and this exits 0 against any database whatsoever. That is the silent pass
 * the whole script exists to prevent, and nothing else in the file would notice.
 *
 * The count comes from a second, deliberately cruder expression over the same
 * string. Two expressions disagreeing is the signal; the schema itself is
 * never duplicated here, and a reformatted table still fails closed rather than
 * being quietly skipped.
 */
const declared = DDL.match(/CREATE TABLE IF NOT EXISTS \w+/g)?.length ?? 0;
if (inspected !== declared) {
  console.error(
    `LiteSaaS: could not check ${DB_PATH} — the schema check read ${inspected} of the ` +
      `${declared} tables this script declares, so it has verified nothing and will not claim\n` +
      'the file is sound. This is a defect in scripts/init-db.mjs, not in your database: the\n' +
      'CREATE TABLE statements have been reformatted in a way the drift check cannot parse.'
  );
  process.exit(1);
}

const added = [];
const failed = [];

if (drift.size) {
  // Add what SQLite can add, because refusing is only correct when there is
  // genuinely nothing this container can do about it.
  //
  // The README's escape hatch does not exist. `npm run db:push` is wired up and
  // documented, but drizzle-kit 0.30.6 fails on every file this script creates —
  // including a pristine one, and including a database with no unique constraints
  // and no indexes at all, where it still reports "index users_email_unique
  // already exists" for an index that is not in the file. So the previous advice
  // ("bring the file up to date") pointed operators at a command that errors out
  // on contact, and left a schema change with no upgrade path but deleting the
  // database. That is what made adding a column to this project effectively
  // un-shippable.
  //
  // Only plain nullable columns go through, and that line is not redundant with
  // SQLite's own checking. SQLite refuses `ADD COLUMN ... NOT NULL` on a table
  // that holds rows, but performs it happily on an empty one — so without this
  // guard the same schema change migrates or fails depending on how much data
  // the operator happened to have. PRIMARY KEY / UNIQUE / CHECK / REFERENCES
  // are rejected either way. All of them are decisions about real data, not ones
  // for a container to make silently at boot, so they fall through to the loud
  // exit below.
  for (const [table, declarations] of drift) {
    for (const declaration of declarations) {
      if (/\b(NOT NULL|PRIMARY KEY|UNIQUE|CHECK|REFERENCES)\b/i.test(declaration)) continue;
      // The declaration comes out of the table body still carrying its trailing
      // comma, which is a syntax error in a standalone ALTER. Swallowing that in
      // a catch below is how a version of this that could add nothing at all
      // still printed a confident migration message.
      const column = declaration.replace(/,\s*$/, '');
      try {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
        added.push(`${table}.${nameOf(column)}`);
      } catch (err) {
        // SQLite rejects some defaults it cannot evaluate (CURRENT_TIMESTAMP on
        // an existing table, for one). Recorded rather than swallowed, so the
        // error below can say which column refused and why.
        failed.push(`${table}.${nameOf(column)} (${err.message})`);
      }
    }
  }
  if (added.length) {
    console.log(`LiteSaaS: added ${added.join(', ')} to ${DB_PATH} (schema was behind)`);
  }

  // Re-read the file rather than trusting the ALTERs. This script's whole reason
  // for existing is that it will not certify a file it has not actually looked
  // at, and "we just added it" is exactly the assumption that check exists to
  // reject. A column that did not really land must fail the boot, not pass it.
  ({ drift } = findDrift());
}

if (drift.size) {
  const names = [...drift].map(([table, ds]) => `${table}(${ds.map(nameOf).join(', ')})`);
  console.error(
    `LiteSaaS: ${DB_PATH} is missing columns the app needs — ${names.join('; ')}\n` +
      'CREATE TABLE IF NOT EXISTS cannot add a column to a table that already exists, and this\n' +
      'container is the only place the schema is applied. These could not be added automatically —\n' +
      'a column that is NOT NULL, or part of a PRIMARY KEY / UNIQUE / CHECK / FOREIGN KEY, cannot\n' +
      'be added to a table that already holds rows without a decision about what to put in the\n' +
      'existing ones. Add them by hand, or delete the file to have it created fresh. If it came from\n' +
      'a Litestream replica, the backup is the stale copy.' +
      (failed.length ? `\nSQLite refused: ${failed.join('; ')}` : '')
  );
  process.exit(1);
}

console.log('LiteSaaS: Database initialized successfully at', DB_PATH);
sqlite.close();