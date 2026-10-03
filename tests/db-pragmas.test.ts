import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// The PRAGMAs in src/db/index.ts are the product. This kit's entire pitch is
// "SQLite in production", and the README backs that with a specific list —
// `journal_mode = WAL` because "readers never block writers", `busy_timeout =
// 5000` because it "eliminates SQLITE_BUSY errors", `synchronous = NORMAL`
// because it is "crash-safe ACID without filesystem fsync stall" — plus a
// benchmark table built on concurrent readers.
//
// Nothing in the suite checked that the code still does any of it. The only
// PRAGMA assertions anywhere were in dashboard-metrics.test.ts, and those check
// that the dashboard *reads* four of them to display in a strip. Delete
// `journal_mode = WAL` and the app drops to a rollback-journal database where a
// reader blocks every writer, the architecture diagram is fiction, and every
// test in the repo stays green.
//
// Two layers, because one is not enough:
//
//   - The source pin catches a pragma being removed or reordered. `page_size`
//     is a trap this way: on a database that already has a table SQLite accepts
//     the statement and ignores it, so it cannot fail loudly.
//   - The behavioural check runs the statements the source *actually contains*
//     against a real database and reads the settings back. This catches a value
//     that survives review but does not do what the README says. `synchronous =
//     OFF` is the shape of that: faster still, and not crash-safe.
//
// One pragma is only covered by the first layer, and the reason is worth
// knowing before anyone "simplifies" it away. better-sqlite3 11.10 enables
// foreign_keys itself, so removing our pragma changes nothing observable and the
// behavioural check below still reads 1. SQLite's own default is off; the driver
// is overriding it. The pragma is therefore redundant today and load-bearing the
// day this binds to a different driver, and the demo seed depends on that FK
// surviving a rolled-back transaction. Only the source pin catches its removal,
// so do not treat the readback as covering it.
//
// A real database rather than a grep, because the point of these statements is
// what they do to SQLite, not what they say. The statements are parsed out of
// the source instead of copied, so this cannot drift into testing a second copy.

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const root = new URL('..', import.meta.url);
const source = readFileSync(fileURLToPath(new URL('src/db/index.ts', root)), 'utf8');

/** Every `sqlite.pragma('…')` in the source, in the order they run. */
const pragmas = [...source.matchAll(/sqlite\.pragma\('([^']+)'\)/g)].map((m) => m[1]);

/**
 * The README's own list, in its order, plus the two we set but do not document.
 *
 * Written out rather than derived from the source, so that dropping a line from
 * the source is a diff here and not a silent pass.
 */
const DOCUMENTED = [
  'page_size = 4096',
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'busy_timeout = 5000',
  'foreign_keys = ON',
];
const OURS = ['cache_size = -64000', 'temp_store = MEMORY'];

test('the connection sets every pragma the README promises, in order', () => {
  // Exact, not a superset: an addition or a removal anywhere in the list is a
  // diff someone has to look at.
  assert.deepEqual(pragmas, [...DOCUMENTED, ...OURS]);

  // A pragma is only honoured before the database grows a table, so the order
  // is not cosmetic: `page_size` after any CREATE TABLE is accepted and ignored.
  assert.equal(pragmas.indexOf('page_size = 4096'), 0, 'page_size must be set on a fresh database');
});

test('the README documents each one it claims, and the code sets them', () => {
  const readme = readFileSync(fileURLToPath(new URL('README.md', root)), 'utf8');

  for (const statement of DOCUMENTED) {
    const name = statement.split(' ')[0];
    assert.ok(pragmas.includes(statement), `src/db/index.ts no longer sets ${statement}`);
    // Matched on the name, not the whole line: the README writes them as
    // `PRAGMA page_size = 4096;` and that formatting is not the claim. What
    // must not drift is the claim existing at all.
    assert.ok(readme.includes(name), `the README no longer documents ${name}`);
  }
});

test('the settings the code asks for are the settings SQLite reports back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'litesaas-pragma-'));
  const db = new Database(join(dir, 'app.db'));
  try {
    for (const statement of pragmas) db.pragma(statement);

    // Read on the same connection, which matters for two of these: `journal_mode`
    // is persisted in the file, `foreign_keys` and `busy_timeout` are per
    // connection and are gone on the next open.
    const read = (name: string) => db.pragma(name, { simple: true });

    assert.equal(read('journal_mode'), 'wal', 'WAL is the whole architecture');
    // 1 is SQLITE_SYNCHRONOUS_NORMAL. 0 is OFF: faster, and not crash-safe.
    assert.equal(read('synchronous'), 1, 'synchronous must be NORMAL, never OFF');
    // 1 is ON. Note this cannot catch the pragma being dropped — the driver
    // already turns it on for us. See the header.
    assert.equal(read('foreign_keys'), 1, 'referential integrity is not being enforced');
    assert.equal(read('busy_timeout'), 5000, 'write bursts raise SQLITE_BUSY again');
    assert.equal(read('page_size'), 4096, 'set too late to take effect on a non-empty database');
    assert.equal(read('cache_size'), -64000);
    assert.equal(read('temp_store'), 2);
  } finally {
    // Closed before the directory goes, or the WAL and SHM files hold the
    // handle and the removal leaves them behind.
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WAL is what a reader gets, not just what the file records', () => {
  // The one claim no single connection's settings can settle. WAL's promise is
  // that a reader and a writer do not block each other, so hold a read
  // transaction open on one connection and take a write on a second.
  //
  // Two connections, and that is the whole test. With a single connection it
  // passes with or without WAL — SQLite takes locks per connection, so one
  // connection may hold SHARED and then upgrade to EXCLUSIVE without
  // conflicting with itself, and the assertion is satisfied by a database that
  // blocks readers and writers exactly as the README says it does not.
  //
  // Under a rollback journal these two do conflict: the writer waits out the
  // 5000ms busy_timeout and then raises SQLITE_BUSY. The failure is slow but
  // certain, which is why the write below is not wrapped in a try.
  const dir = mkdtempSync(join(tmpdir(), 'litesaas-pragma-'));
  const writer = new Database(join(dir, 'app.db'));
  // Opened after the pragmas, so it reads WAL out of the file — journal_mode is
  // persisted, unlike foreign_keys and busy_timeout.
  const reader = new Database(join(dir, 'app.db'));
  try {
    for (const statement of pragmas) writer.pragma(statement);
    writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    writer.prepare('INSERT INTO t (id) VALUES (?)').run(1);

    // An open read transaction on the other connection: the analytics page that
    // has not finished rendering while a signup writes.
    reader.pragma('busy_timeout = 5000');
    const count = reader.prepare('SELECT count(*) AS n FROM t');
    reader.exec('BEGIN');
    count.get();

    writer.prepare('INSERT INTO t (id) VALUES (?)').run(2);

    reader.exec('COMMIT');
    assert.equal(count.get().n, 2, 'the write did not land alongside the open reader');
  } finally {
    reader.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the data directory is created before the connection is opened', () => {
  // `new Database(DB_PATH)` throws SQLITE_CANTOPEN on a missing directory — SQLite
  // creates the *file*, never the path to it. So a fresh clone whose `data/` has
  // not been created yet cannot start, and neither can any container image that
  // stops shipping the directory.
  //
  // It is four lines above the connection and nothing else creates it: no script,
  // no entrypoint. `docker compose up` on a host with no `data/` fails at import
  // of this module, which surfaces as a boot loop rather than as anything naming
  // a missing directory. Drop the guard and the only signal is that the app is
  // down.
  const at = source.indexOf('createSqliteConnection(): Database.Database');
  assert.notEqual(at, -1, 'the connection factory was renamed or removed; this test needs revisiting');

  // Inside the guard, not merely present. Searching for the call alone passed with
  // `if (false) {` still sitting in front of it — the mkdir is there, and it is
  // dead. Reachability is the property, so the assertion spans the statement.
  // `recursive: true` is in the pattern deliberately. Without it mkdirSync throws
  // ENOENT on a missing parent, and the default `data/app.db` never notices —
  // its parent is the working directory, which always exists. A DATABASE_URL
  // pointing at a nested path on a mounted volume is the case that breaks, and it
  // breaks as a boot loop naming nothing.
  const mk = source.search(
    /if \(!fs\.existsSync\(dir\)\) \{\s*fs\.mkdirSync\(dir, \{ recursive: true \}\);/
  );
  assert.notEqual(
    mk,
    -1,
    'nothing reachable creates the database directory; a fresh clone cannot start'
  );

  // Before the factory is ever called, not merely before the `new Database` line —
  // the factory is what opens the connection, so a mkdir inside it would already
  // be too late by the time it ran.
  assert.ok(
    mk < source.indexOf('createSqliteConnection()'),
    'the directory is created inside the factory, which runs before it makes the directory'
  );

  // …and it is the directory of the configured path, not a hardcoded one. A
  // DATABASE_URL pointing outside `data/` is the documented way to put the file
  // on a mounted volume, and a hardcoded `data/` leaves that mount unwritable.
  assert.match(
    source,
    /const dir = path\.dirname\(DB_PATH\);/,
    'the directory must come from the configured path or a mounted volume is never created'
  );
});

test('the connection is a dev-only singleton, so hot reload does not leak handles', () => {
  // Two halves of one idiom, and either can be removed by a well-meaning tidy-up
  // that reads as pure cleanup. Both are invisible: `next dev` still boots, every
  // test still passes, and the only symptom is a file descriptor count that
  // climbs with each save until the editor or the OS complains.
  //
  // The NODE_ENV half is the one that reads like a bug. Dropping the guard makes
  // production *also* publish its handle on `global` — a single reused,
  // never-closed connection outliving whatever module scope made it. Nothing in
  // a single-process production server exercises that today, so it cannot be
  // justified by a test either; it is pinned because the guard is what says the
  // leak is intentional and bounded to development.
  assert.match(
    source,
    /global\.__sqliteDbInstance \|\| createSqliteConnection\(\)/,
    'every hot reload opens a fresh connection and abandons the old one'
  );
  assert.match(
    source,
    /if \(process\.env\.NODE_ENV !== 'production'\) \{\s*global\.__sqliteDbInstance = sqliteInstance;/,
    'the cached handle must stay out of global in production'
  );

  // …and the gate has to be a comparison, not a truthy test. `NODE_ENV` is always
  // set to something by both `next dev` and `next start`, so a falsy check passes
  // in production — which is the half that matters.
  assert.doesNotMatch(
    source,
    /if \(process\.env\.NODE_ENV\) \{/,
    'a truthy NODE_ENV test publishes the handle in production as well'
  );
});
