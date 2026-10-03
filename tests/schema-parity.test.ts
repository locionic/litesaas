import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../src/db/schema.ts';

// Run: npm test
//
// The schema is declared twice, in two places that cannot see each other:
//
//   scripts/init-db.mjs  — hand-written CREATE TABLE IF NOT EXISTS. Runs from
//                          `npm start` and from the container CMD, so this is
//                          what production actually gets.
//   src/db/schema.ts     — what Drizzle reads and writes every query with.
//
// Nothing made them agree, so a column added to one is silently absent from the
// other: development (documented as `npm run db:push`, i.e. Drizzle) works
// while the container writes SQL against a table that has no such column, and
// the failure lands on whichever deploy touched the table first. Same shape as
// the PLANS copy drifting from CHECKOUT_MODE, and just as invisible — a wrong
// column name does not fail at build time.
//
// `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
// exists, so an existing deployment never picks up the Drizzle-side change
// either. That is what makes this a parity check rather than a migration.

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dir = mkdtempSync(join(tmpdir(), 'litesaas-schema-'));
const dbPath = join(dir, 'parity.db');

// init-db.mjs reads the path from env on import and runs top-level, so set it
// first. This is also the exact path `npm start` and the container take.
process.env.DATABASE_URL = dbPath;
await import('../scripts/init-db.mjs');

const sqlite = new Database(dbPath, { readonly: true });

const tables = {
  users: schema.users,
  sessions: schema.sessions,
  subscriptions: schema.subscriptions,
  projects: schema.projects,
};

const sqlColumns = (table: string) =>
  (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

const sqlColumnTypes = (table: string) =>
  (
    sqlite.prepare(`pragma table_info(${table})`).all() as { name: string; type: string }[]
  ).map((c) => [c.name, c.type.toLowerCase()]);

const declaredColumns = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((c) => c.name);

test.after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('every declared table exists in the SQL schema', () => {
  const found = (
    sqlite.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
  ).map((r) => r.name);
  for (const name of Object.keys(tables)) {
    assert.ok(found.includes(name), `scripts/init-db.mjs is missing table ${name}`);
  }
});

for (const [name, table] of Object.entries(tables)) {
  test(`${name}: the SQL columns match the Drizzle schema exactly`, () => {
    // Both directions. A missing column breaks writes; an extra one means the
    // two files were edited together, so neither check is redundant.
    assert.deepEqual(sqlColumns(name), declaredColumns(table));
  });
}

test('the SQL column types match the Drizzle schema, not just the names', () => {
  // The name parity above is not enough, and the difference is an outage rather
  // than a wrong value. `sessions.expires_at` is read as
  // `session.expiresAt.getTime()` — a method call on whatever the driver
  // returned. Declared TEXT, SQLite hands back a string, and that is
  // `TypeError: session.expiresAt.getTime is not a function` on every request
  // the signed-in user makes, from the one file the container writes.
  //
  // Passing the name check while failing this one needs no exotic edit: anyone
  // writing this DDL by hand out of Postgres habits writes TIMESTAMP, and
  // `getTableConfig(...).columns.map(c => c.name)` does not notice that the
  // column is still called `expires_at`.
  for (const [name, table] of Object.entries(tables)) {
    const expected = getTableConfig(table).columns.map((c) => [c.name, c.getSQLType()]);
    assert.deepEqual(
      sqlColumnTypes(name),
      expected,
      `${name}: the SQL storage class and the Drizzle column disagree`
    );
  }
});

test('every integer column is a timestamp, not a raw number', () => {
  // The type check above is structurally blind to this one. Measured, not
  // assumed: `getSQLType()` returns `integer` for `integer('expires_at')` and
  // for `integer('expires_at', { mode: 'timestamp' })` alike — the mode is a
  // Drizzle-side codec and never reaches SQL. So both halves of the drift this
  // file exists to catch can agree, right up to the `.getTime()`.
  //
  // Two call sites depend on it, both on the signed-in path:
  //
  //   src/lib/auth.ts:73       session.expiresAt.getTime()   — the expiry check
  //   src/app/dashboard/page.tsx:297   p.createdAt.toISOString()  — every row
  //
  // The first fails *quietly*, which is the part worth writing down. It sits
  // inside the try whose catch returns null — the signal `getCurrentUser`
  // documents for "there is no session here" — and the dashboard redirects null
  // to /login. So dropping the mode signs every user out, everywhere, with one
  // log line, and from the user's side it is indistinguishable from a cookie
  // that aged out. An expiry check that fails open into a logout rather than a
  // visible error is the worst shape this could take, and it is the one it took.
  //
  // Every integer column in this schema is a timestamp, so the filter below
  // should never skip one; the count is here because a filter that matched
  // nothing would pass this against any schema at all.
  const integers: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    for (const column of getTableConfig(table).columns) {
      if (column.getSQLType() !== 'integer') continue;
      integers.push(`${name}.${column.name}`);
      // `mode` is absent from drizzle 0.38's column type and present on the
      // object — the codec is internal, not part of the declared surface.
      const { mode } = column as { mode?: string };
      assert.equal(
        mode,
        'timestamp',
        `${name}.${column.name} is read as a Date at the call site; declared as a raw integer, .getTime() and .toISOString() are undefined on it`
      );
    }
  }
  assert.ok(
    integers.length >= 8,
    `this test inspected ${integers.length} integer columns and is about to stop proving anything`
  );
});

test('the UNIQUE constraints the code relies on are in the SQL', () => {
  // registerAction turns SQLITE_CONSTRAINT_UNIQUE into a friendly "that email
  // already exists", and subscriptions.userId being unique is what stops a
  // second row shadowing the plan. Drizzle declares these; the SQL must too.
  //
  // Asked for by meaning, not by name: a column-level UNIQUE becomes an
  // implicit `sqlite_autoindex_<table>_<n>`, whose name says nothing about
  // which column it covers. `origin: 'u'` is the UNIQUE constraint (as opposed
  // to 'pk' or a hand-made index), and index_info gives the columns.
  const uniqueColumnSets = (table: string): string[][] =>
    (sqlite.prepare(`pragma index_list(${table})`).all() as { name: string; unique: number; origin: string }[])
      .filter((i) => i.unique === 1 && i.origin === 'u')
      .map((i) =>
        (sqlite.prepare(`pragma index_info(${i.name})`).all() as { name: string }[]).map((c) => c.name)
      );

  assert.ok(
    uniqueColumnSets('users').some((cols) => cols.join() === 'email'),
    'users.email must stay UNIQUE — registerAction catches the constraint by code'
  );
  assert.ok(
    uniqueColumnSets('subscriptions').some((cols) => cols.join() === 'user_id'),
    'subscriptions.user_id must stay UNIQUE — a second row would shadow the plan'
  );
});

test('foreign keys cascade, so deleting a user cleans up their rows', () => {
  const tablesWithFks = ['sessions', 'subscriptions', 'projects'];
  for (const name of tablesWithFks) {
    const sql = sqlite
      .prepare("select sql from sqlite_master where type = 'table' and name = ?")
      .get(name) as { sql: string } | undefined;
    assert.ok(sql, `table ${name} not found`);
    assert.match(
      sql.sql,
      /REFERENCES\s+users\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i,
      `${name}.user_id must ON DELETE CASCADE users(id), as src/db/schema.ts declares`
    );
  }
});