import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Run: npm test
//
// scripts/init-db.mjs is the only place the schema is applied in a Docker deploy
// — `npm run db:push` never runs there — and CREATE TABLE IF NOT EXISTS creates
// a missing table while silently ignoring an existing one, so it can never add a
// column. A data/app.db bind-mounted from before a schema change therefore
// started the app cleanly and then failed on the first query for the missing
// column: a Next error page with an empty container log, because `next start`
// does not print server render errors.
//
// The second half is why the check reads its expectations out of the DDL instead
// of a list written beside it. scripts/init-db.mjs and src/db/schema.ts are two
// hand-maintained copies of one schema, so the check cannot notice the latter
// drifting ahead — which is what the parity test at the bottom is for.

const root = fileURLToPath(new URL('..', import.meta.url));
const initDb = join(root, 'scripts', 'init-db.mjs');
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');

/** Run the container's schema step against a file, reporting instead of throwing. */
const init = (dbPath: string): { status: number; output: string } => {
  try {
    const output = execFileSync(process.execPath, [initDb], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: dbPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const withTempDb = (fn: (dbPath: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'litesaas-initdb-'));
  try {
    fn(join(dir, 'app.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a fresh database is created and accepted', () => {
  withTempDb((dbPath) => {
    const first = init(dbPath);
    assert.equal(first.status, 0, first.output);

    // Every container start re-runs this, so it has to be a no-op on a good file.
    const second = init(dbPath);
    assert.equal(second.status, 0, second.output);
  });
});

test('a table that is missing entirely is created', () => {
  // The case CREATE TABLE IF NOT EXISTS was always good at, and still is.
  withTempDb((dbPath) => {
    assert.equal(init(dbPath).status, 0);
    new Database(dbPath).exec('DROP TABLE subscriptions');

    const rerun = init(dbPath);
    assert.equal(rerun.status, 0, rerun.output);
    // Existence, not contents: the table comes back empty. Read-write, not
    // readonly — a read-only handle cannot open the -shm file a WAL database
    // needs, so it reports nothing about tables it did not write.
    const tables = new Database(dbPath)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('subscriptions'), `expected subscriptions, found ${tables.join(', ')}`);
  });
});

test('a column that is missing refuses to start, and names itself', () => {
  withTempDb((dbPath) => {
    assert.equal(init(dbPath).status, 0);
    new Database(dbPath).exec('ALTER TABLE projects DROP COLUMN description');

    const rerun = init(dbPath);
    assert.equal(rerun.status, 1);
    // The table and the column, or the operator still has to guess which.
    assert.match(rerun.output, /projects/);
    assert.match(rerun.output, /description/);
    // The fix, not only the diagnosis.
    assert.match(rerun.output, /delete it|up to date/i);
  });
});

test('the drifted schema is what a real start sees', () => {
  // `npm start` is `init-db && next start`, and the Dockerfile's CMD opens the
  // same way, so a non-zero exit here is the only thing between a drifted file
  // and a container serving error pages. Importing the script is the closest a
  // test gets to running that chain without binding a port.
  withTempDb((dbPath) => {
    assert.equal(init(dbPath).status, 0);
    new Database(dbPath).exec('ALTER TABLE users DROP COLUMN name');

    const res = spawnSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(initDb)})`],
      { cwd: root, env: { ...process.env, DATABASE_URL: dbPath }, encoding: 'utf8' }
    );
    assert.equal(res.status, 1, 'a drifted schema must stop the process, not just log');
  });
});

// That the DDL and src/db/schema.ts declare the same columns is NOT checked
// here. tests/schema-parity.test.ts already does it, and better: it reads the
// drizzle schema through getTableConfig rather than regexing the source, and
// compares both directions so a column added to either file alone fails.
test('the S3 replica is restored before the schema is checked', () => {
  // init-db verifies the file it opens. Run after `litestream restore`, that is
  // the restored database — the one that will actually serve traffic. Run
  // before, it validates an empty file that the restore is about to overwrite,
  // and the check silently never fires on the deployment that needs it.
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const cmd = dockerfile.slice(dockerfile.indexOf('CMD '));
  assert.ok(cmd.indexOf('litestream restore') > -1, 'the restore must still be there');
  assert.ok(
    cmd.indexOf('litestream restore') < cmd.indexOf('init-db.mjs'),
    'restore must come first, or the schema check runs against the wrong file'
  );
});