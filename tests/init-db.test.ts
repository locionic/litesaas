import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const init = (dbPath: string, script = initDb): { status: number; output: string } => {
  try {
    const output = execFileSync(process.execPath, [script], {
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
    const tables = (
      new Database(dbPath)
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    assert.ok(tables.includes('subscriptions'), `expected subscriptions, found ${tables.join(', ')}`);
  });
});

test('a missing nullable column is added rather than refused', () => {
  // Refusing was only ever right because nothing else could do it. `npm run
  // db:push` is the documented escape hatch and it does not work: drizzle-kit
  // 0.30.6 fails on every file this script creates, including a pristine one and
  // a database with no unique constraints and no indexes at all, where it still
  // reports "index users_email_unique already exists" for an index the file does
  // not contain. So a bind-mounted database carried over from before a schema
  // change had no upgrade path except deleting it.
  //
  // A plain nullable column is the case SQLite can settle on its own, so the
  // script settles it. The old error text ("bring the file up to date") pointed
  // operators at a command that errors out on contact.
  withTempDb((dbPath) => {
    assert.equal(init(dbPath).status, 0);
    new Database(dbPath).exec('ALTER TABLE projects DROP COLUMN description');

    const rerun = init(dbPath);
    assert.equal(rerun.status, 0, rerun.output);

    // Added, not merely tolerated: a certifier that exits 0 over a column it
    // did not put there is the failure this whole script exists to prevent.
    const columns = (
      new Database(dbPath, { readonly: true })
        .prepare('PRAGMA table_info(projects)')
        .all() as { name: string }[]
    ).map((c) => c.name);
    assert.ok(columns.includes('description'), `expected description, found ${columns.join(', ')}`);

    // Loud, so an operator can see their file changed without them choosing to.
    assert.match(rerun.output, /added projects\.description/);
  });
});

test('the README describes the upgrade path the script actually implements', () => {
  // The same bidirectionality db-pragmas.test.ts enforces for the PRAGMAs. The
  // README used to promise "automatic schema migrations (`npm run db:push`)" and
  // to tell operators to bring a stale file "up to date" — which is a command
  // that fails against every file this script creates. A claim that is wrong in
  // a starter kit costs someone their afternoon, so it is pinned here rather
  // than left to review.
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

  assert.doesNotMatch(
    readme,
    /schema migrations \(`npm run db:push`\)/,
    'db:push does not migrate an existing database; do not advertise it as the migration path'
  );
  assert.match(
    readme,
    /adds any column that is missing/,
    'the README must state that a restart applies schema changes'
  );
  // The honest counterweight to the above: db:push IS how a fresh local clone
  // gets its first database, which is why the quickstart still calls it. A
  // rewrite that removed it entirely would be a different kind of wrong.
  assert.match(readme, /npm run db:push/, 'the quickstart still needs db:push to create a fresh file');
});

test('a missing NOT NULL column still refuses, names itself, and is left alone', () => {
  // The other half of the line the migration draws. NOT NULL means a value has
  // to be invented for every row that already exists, and PRIMARY KEY / UNIQUE /
  // CHECK / FOREIGN KEY cannot be added to a populated table at all. Those are
  // decisions about real data, not for a container to make silently at boot.
  withTempDb((dbPath) => {
    assert.equal(init(dbPath).status, 0);
    new Database(dbPath).exec('ALTER TABLE projects DROP COLUMN name');

    const rerun = init(dbPath);
    assert.equal(rerun.status, 1);
    // The table and the column, or the operator still has to guess which.
    assert.match(rerun.output, /projects/);
    assert.match(rerun.output, /name/);
    // The fix, not only the diagnosis.
    assert.match(rerun.output, /delete it|by hand/i);
    // Refused means not written, not refused-after-inventing-a-value.
    const columns = (
      new Database(dbPath, { readonly: true })
        .prepare('PRAGMA table_info(projects)')
        .all() as { name: string }[]
    ).map((c) => c.name);
    assert.ok(!columns.includes('name'), `name must not be backfilled, found ${columns.join(', ')}`);
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

test('a DDL this script cannot parse is refused, not passed', () => {
  // The drift check reads its expectations out of the same DDL string it then
  // runs, which makes that string the check's own weak link. Reformat it so the
  // parser matches nothing: `drift` stays empty and, without a guard, the
  // script exits 0 against any database at all — the exact silent pass it was
  // written to prevent. Every case above still passes in that state, because
  // they all drop a real column, which takes a working parser to notice.
  const dir = mkdtempSync(join(tmpdir(), 'litesaas-initdb-'));
  try {
    // better-sqlite3 resolves from the importing file's directory, so the copy
    // needs this project's node_modules within reach of it.
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const probe = join(dir, 'init-db.mjs');
    // `) ;` is still valid SQL, so the tables are created and the database is
    // genuinely sound — the only thing that fails is the check claiming to have
    // looked at it. That separation is the point: a broken parser must not be
    // reported as a broken database, or the operator chases the wrong file.
    writeFileSync(probe, readFileSync(initDb, 'utf8').replaceAll(/\n(\s*)\);/g, '\n$1) ;'));

    const dbPath = join(dir, 'app.db');
    const res = init(dbPath, probe);
    assert.equal(res.status, 1, 'a check that read no tables must not certify the file');
    assert.match(res.output, /defect in scripts\/init-db\.mjs/);
    assert.doesNotMatch(res.output, /missing columns/, 'this is the parser, not the database');

    const tables = (
      new Database(dbPath)
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    assert.ok(tables.includes('projects'), 'the DDL is valid SQL; it must still have run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('the directory is created, so a DATABASE_URL may point anywhere', () => {
  // Behavioural on purpose. The Dockerfile does `mkdir -p /app/data`, so the
  // obvious test — point at the default and watch it work — passes with the
  // guard deleted. What breaks is the configured path: DATABASE_URL is the
  // documented way to move the file onto a mounted volume, and SQLite creates
  // the *file*, never the path to it, so the script exits SQLITE_CANTOPEN and
  // the container boots in a loop naming nothing.
  //
  // `recursive: true` is the other half. Without it mkdir throws ENOENT on a
  // missing parent, and the default `data/app.db` never notices — its parent is
  // the working directory, which always exists.
  const dir = mkdtempSync(join(tmpdir(), 'litesaas-initdb-'));
  const nested = join(dir, 'var', 'lib', 'litesaas', 'app.db');
  try {
    const result = init(nested);
    assert.equal(result.status, 0, `the script must create the path, not fail on it: ${result.output}`);
    assert.ok(existsSync(nested), 'the script reported success without creating the file');

    // …and created a real database, rather than an empty directory that a later
    // run would have to fill in.
    const db = new Database(nested);
    try {
      const tables = db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get() as { n: number };
      assert.ok(tables.n >= 4, `expected the schema, found ${tables.n} tables`);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the page size is set here, because the app can no longer set it', () => {
  // These two files each declare seven pragmas and nothing pins them to each
  // other, so six of them are checked and this one was not. It is the only
  // statement in either file that has to happen FIRST: SQLite ignores
  // `page_size` on a database that already holds a table, and by the time
  // src/db/index.ts opens one, this script has created four.
  //
  // So the app sets 4096 on every connection and means it, and the file on disk
  // keeps whatever it was created with. Dropping this line leaves the default —
  // which happens to be 4096 too, so the README's claim stays true by luck and
  // nothing notices. Changing it to 1024 is the shape that does show up: every
  // page in the file halves, and no connection afterwards can put it back.
  withTempDb((dbPath) => {
    const first = init(dbPath);
    assert.equal(first.status, 0, first.output);

    const db = new Database(dbPath);
    try {
      assert.equal(
        db.pragma('page_size', { simple: true }),
        4096,
        'the file must be created with the page size the README promises'
      );
    } finally {
      db.close();
    }
  });
});