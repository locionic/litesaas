import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `.env.example` documented fifteen variables and docker-compose.yml forwarded
// two of them. Compose uses `.env` to *interpolate* the compose file; it does
// not forward it into the container, so every other name was simply absent at
// runtime no matter what the operator wrote. Two of those absences were silent
// and severe:
//
//   LITESTREAM_BUCKET — the Dockerfile's CMD branches on it, so an unset value
//   skips both the restore and the replicate. The README's "Option B" promises
//   streaming disaster recovery; a follower got none, and no error, because
//   the branch that would have failed never ran.
//
//   NEXT_PUBLIC_STRIPE_PRO_PRICE_ID — read server-side by billing.ts, and
//   Next inlines NEXT_PUBLIC_* into the server bundle too. The compiled
//   line_items carries the price as a string literal (`price:"price_1..."`) with
//   no process.env read surviving, so it is a BUILD-time variable. It was passed
//   as neither a build arg nor an environment entry: it inlined empty, checkout
//   silently never appeared, and the dashboard banner told the operator to set
//   STRIPE_SECRET_KEY — which they may well already have.
//
// Checked as source because `npm test` runs no Docker. What is asserted is what
// `docker compose build` and `docker compose up` would do with these files.

const root = fileURLToPath(new URL('..', import.meta.url));
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const envExample = readFileSync(join(root, '.env.example'), 'utf8');

/** Every `NAME=` at column 0 in .env.example — the documented surface. */
const documented = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

/** The value shipped for `name`, or undefined if it is not assigned at all. */
const shipped = (name: string): string | undefined =>
  envExample.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];

/** The slice of the compose file between two markers, with both proved present. */
const between = (start: string, end: string): string => {
  const from = compose.indexOf(start);
  assert.ok(from > -1, `docker-compose.yml has no ${start.trim()} block`);
  const to = compose.indexOf(end, from + start.length);
  assert.ok(to > from, `docker-compose.yml has no ${end.trim()} after ${start.trim()}`);
  return compose.slice(from, to);
};

const buildArgs = [...between('args:', 'ports:').matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
const environment = [
  ...between('environment:', 'restart:').matchAll(/^\s+-\s+([A-Z][A-Z0-9_]*)=/gm),
].map((m) => m[1]);

const buildArgNames = [...dockerfile.matchAll(/^ARG ([A-Z][A-Z0-9_]*)/gm)].map((m) => m[1]);

/**
 * The Dockerfile's exec-form CMD, and nothing before it.
 *
 * `indexOf('CMD ')` is not enough: a comment explaining the CMD reads "the CMD
 * below…", so the slice starts inside a comment block and every variable parsed
 * out of it belongs to prose. Anchored to the start of a line instead.
 */
const CMD_LINE = dockerfile.slice(dockerfile.indexOf('\nCMD ') + 1);

/**
 * Strip comments before harvesting `process.env.X`, or every explanation of a
 * variable counts as a read of it — and a comment is the easiest place for a
 * name to be mentioned without being depended on.
 */
const withoutComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // A URL literal: `https://…` would otherwise leave a tail that looks like a
    // comment and swallow the end of the line.
    .replace(/https?:\/\/\S+/g, '');

/**
 * Every `process.env.NAME` the shipped code actually reads.
 *
 * Deliberately not the whole repository. Tests/ mention variables in prose and
 * in mutations; scripts/init-db.mjs is covered separately, where the whole
 * point is that it reads DATABASE_URL; next.config.ts and drizzle.config.ts
 * read none. tests/ is the one directory where a harvested name means a test
 * talked about it, not that the app depends on it.
 *
 * Scoped to src/ and scripts/ — the code that ships in the image.
 */
const readInCode = (() => {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        for (const m of withoutComments(readFileSync(full, 'utf8')).matchAll(
          /process\.env\.([A-Z][A-Z0-9_]*)/g
        )) {
          found.add(m[1]);
        }
      }
    }
  };
  walk(join(root, 'src'));
  walk(join(root, 'scripts'));
  return found;
})();

test('every variable the code reads is one .env.example documents', () => {
  // The other direction of parity, and the one with no test behind it. Every
  // variable here is reached by an operator reading .env.example and following
  // the README — and this exact file already documents the failure twice: an
  // operator who copied the example set the keys Stripe needed, and every
  // delivery then failed verification because the signing secret was never
  // documented as required (it is set in the Stripe dashboard, nowhere in this
  // repo). Nothing caught that except a person reading it.
  //
  // So the check is not "are the documented ones wired up" — the tests above
  // already cover that. It is the reverse: code may not read a name the docs do
  // not list. A new feature reads a new variable, nobody adds it to the example,
  // and the deploy inherits a silent default.
  //
  // NODE_ENV is the one legitimate exception and is named here rather than
  // filtered by pattern: it is set by `next dev` / `next start` and by the
  // Dockerfile, is deliberately not an operator knob, and an operator who set it
  // by hand would break the demo gate (`isDemoEnabled` refuses anything that is
  // not exactly 'development').
  const FRAMEWORK_OWNED = new Set(['NODE_ENV']);

  assert.ok(readInCode.size > 0, 'no process.env reads found — the scan is broken');

  const undocumented = [...readInCode].filter((n) => !documented.includes(n) && !FRAMEWORK_OWNED.has(n));
  assert.deepEqual(
    undocumented,
    [],
    `the code reads ${undocumented.join(', ')} but .env.example does not document ${
      undocumented.length === 1 ? 'it' : 'them'
    }`
  );
});

test('the webhook signing secret is documented where an operator will read it', () => {
  // Anchored to the code, not to prose. `STRIPE_WEBHOOK_SECRET` is the only
  // thing that turns a paid order into Pro — billing.ts refuses checkout
  // without it for exactly this reason — and it appears nowhere in the README,
  // while .env.example labelled the whole block "Optional for billing demo"
  // with no per-variable note. So the documented path to taking money was: set
  // the secret key and the price id, deploy, and quietly charge every customer
  // without delivering the plan. The dashboard reports `?billing=webhook`, but
  // only after somebody has already clicked Upgrade and real money has moved.
  //
  // The realistic regression is a README rewrite during a landing-page refresh
  // that drops the section, so both files are pinned. A mention alone is not
  // enough: the endpoint path has to be named, because that is the part the
  // operator cannot guess and the part Stripe needs spelled out.
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const billing = readFileSync(join(root, 'src', 'app', 'actions', 'billing.ts'), 'utf8');

  // The dependency this documents must still exist, or the docs are describing
  // a guard that has been removed and the section is stale for a new reason.
  assert.match(
    billing,
    /isRealSecret\(process\.env\.STRIPE_WEBHOOK_SECRET\)/,
    'the webhook guard this documentation exists for is gone; revisit these docs'
  );

  assert.match(envExample, /STRIPE_WEBHOOK_SECRET/, '.env.example must still carry the variable');
  assert.match(readme, /STRIPE_WEBHOOK_SECRET/, 'the README must tell an operator to set it');
  assert.match(
    readme,
    /\/api\/webhooks\/stripe/,
    'the README must name the endpoint to register in Stripe, not just the variable'
  );

  // And the two Next.js variables really are build-time while this one is not —
  // the advice is only safe to give while that stays true, and getting it
  // backwards costs an operator either a pointless rebuild or a silent no-op.
  assert.match(
    readme,
    /STRIPE_WEBHOOK_SECRET[\s\S]{0,400}?restart[\s\S]{0,200}?no rebuild/i,
    'the README must say the webhook secret is a restart, unlike the NEXT_PUBLIC_* vars'
  );
});

test('both compose blocks were found, or the checks below pass vacuously', () => {
  // A mis-sliced block reads as empty, which would make every parity assertion
  // below fail loudly rather than silently — but it would also make a
  // *regression* here pass. Pin the shape.
  assert.ok(buildArgs.length > 0, 'no build args parsed from docker-compose.yml');
  assert.ok(environment.length > 0, 'no environment entries parsed from docker-compose.yml');
  const unknown = [...buildArgs, ...environment].filter((n) => !documented.includes(n));
  assert.deepEqual(unknown, [], `compose names a variable .env.example omits: ${unknown.join(', ')}`);
});

test('every documented variable reaches the container through the right channel', () => {
  assert.ok(documented.length > 0, 'no variables parsed from .env.example');
  const missing: string[] = [];

  for (const name of documented) {
    // Next inlines NEXT_PUBLIC_* at build time — in the server bundle too — so
    // a runtime environment entry is dead weight and an undeclared build arg
    // cannot be passed at all. Everything else is read at runtime.
    const channel = name.startsWith('NEXT_PUBLIC_') ? buildArgs : environment;
    if (!channel.includes(name)) {
      missing.push(
        `${name} is documented in .env.example but is not ${
          name.startsWith('NEXT_PUBLIC_') ? 'a build arg' : 'an environment entry'
        } in docker-compose.yml`
      );
    }
  }

  assert.deepEqual(missing, [], `\n  ${missing.join('\n  ')}\n`);
});

test('a build arg the Dockerfile does not declare cannot be passed in', () => {
  // Compose will happily accept an arg the Dockerfile never declared; the
  // build then has no variable to inline, and the value is silently empty.
  const undeclared = buildArgs.filter((name) => !buildArgNames.includes(name));
  assert.deepEqual(undeclared, [], `declared as a build arg but never ARG'd: ${undeclared.join(', ')}`);
});

test('the litestream binary is fetched for the platform being built', () => {
  // The one thing this Dockerfile pulls over the network is a compiled binary,
  // and the URL used to name one architecture outright. On a native arm64 host
  // that tarball extracts fine and `litestream` is simply not executable, so
  // the CMD's `exec litestream replicate` fails and the app never starts.
  //
  // The reason it survived: Docker Desktop on Apple silicon defaults to amd64
  // emulation, so a build from an M-series Mac produced a working image and a
  // developer on that machine had no way to see the break. It only bites a
  // native arm64 build — Graviton, an arm64 CI runner, `buildx --platform` —
  // which is precisely where nobody was looking.
  const add = dockerfile.match(/^ADD\s+(\S+)/m);
  assert.ok(add, 'the Dockerfile no longer fetches litestream over the network at all');

  assert.match(
    add[1],
    /linux-\$\{TARGETARCH\}\.tar\.gz$/,
    `the litestream URL must select by platform, not name one: ${add[1]}`
  );

  // Named architectures are the failure this is guarding against, so they are
  // banned outright rather than merely discouraged.
  assert.doesNotMatch(
    add[1],
    /linux-(amd64|arm64|arm6|arm7)/,
    'the URL hardcodes an architecture again'
  );

  // TARGETARCH is an *automatic* platform ARG: BuildKit only sets it for a stage
  // that declares it, so a reference without a declaration in the same stage
  // expands to the empty string and the ADD 404s — the build fails for everyone,
  // which is louder than the bug above and still not what the line reads as.
  const arg = dockerfile.indexOf('ARG TARGETARCH');
  assert.notEqual(arg, -1, 'TARGETARCH is used but never ARGd, so it expands empty and 404s');
  assert.ok(arg < dockerfile.indexOf(add[0]), 'ARG TARGETARCH must precede the ADD that uses it');

  // Only reachable because of the BuildKit syntax header. Without it the
  // automatic ARG is unset on a classic builder and the same 404 lands.
  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1$/m);
});

test('every variable the CMD reads is one compose actually passes', () => {
  // The CMD tests `[ -n "$LITESTREAM_BUCKET" ]` to decide whether to restore and
  // replicate at all. Rename one side and backups stop silently — the same
  // failure this file started with.
  //
  // The name is matched as a whole token, not with includes(): "$LITESTREAM_BUCKET"
  // is a substring of "$LITESTREAM_BUCKET_NAME", so a plain contains check
  // calls a renamed shell variable correct and never fires.
  const cmd = CMD_LINE;
  const shellVars = [
    ...new Set([...cmd.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\}?/g)].map((m) => m[1])),
  ];
  assert.ok(shellVars.length > 0, 'the CMD interpolates no shell variables — the slice is wrong');

  const unpassed = shellVars.filter((name) => !environment.includes(name));
  assert.deepEqual(
    unpassed,
    [],
    `the CMD reads $${unpassed.join(', $')} but docker-compose.yml passes no such variable`
  );
});

test('one variable decides where the database is, and the backup reads it too', () => {
  // The failure: the app opens `process.env.DATABASE_URL` while the Dockerfile's
  // CMD and litestream.yml each named /app/data/app.db independently. Point
  // DATABASE_URL anywhere — a documented, supported knob, and exactly what an
  // operator reaches for to move off a bind mount — and the app writes one file
  // while Litestream faithfully replicates another, one nothing ever writes.
  // There is no error: the backups are current, the snapshots are non-empty,
  // and the container restarts clean. A restore then drops a stale database
  // into a container whose app opens a different, empty one. Same shape as the
  // LITESTREAM_BUCKET case above, one variable over.
  const litestream = readFileSync(join(root, 'litestream.yml'), 'utf8');
  const dbIndex = readFileSync(join(root, 'src/db/index.ts'), 'utf8');
  const initDb = readFileSync(join(root, 'scripts/init-db.mjs'), 'utf8');

  // Stated per file because "somewhere in the repo" is satisfied by one of the
  // three while the other two drift — and a backup pointed at the wrong file is
  // exactly as broken as no backup at all.
  const watched = litestream.match(/^\s*-\s*path:\s*(.+)$/m);
  assert.ok(watched, 'litestream.yml declares no dbs[].path to check');
  assert.equal(
    watched[1].trim(),
    '${DATABASE_URL}',
    'litestream must replicate the database the app actually opens'
  );

  // The restore half names its target on the command line rather than in the
  // config, so the config check above does not cover it. A restore pointed at
  // the wrong path is a restore that silently does nothing.
  const cmd = CMD_LINE;
  assert.match(
    cmd,
    /litestream restore [^;]*\$DATABASE_URL/,
    'the restore must target DATABASE_URL, not a path of its own'
  );
  // The negative form is the one that actually holds, and it is immune to how
  // the line is escaped: the exec form wraps the shell string in JSON, so the
  // quotes around $DATABASE_URL reach this file as \". Asserting on those
  // would break the moment the CMD is reformatted, and a test that breaks when
  // the code is fine is a test that stops being read. Whatever the quoting, the
  // CMD may not name a database file — $DATABASE_URL decides it.
  assert.doesNotMatch(
    cmd,
    /app\.db|\/data\//,
    'the CMD must not name a database path; DATABASE_URL is the only source'
  );

  // And the app half, so a refactor that stops reading the variable cannot leave
  // the three quietly disagreeing again.
  assert.match(dbIndex, /process\.env\.DATABASE_URL/);
  assert.match(initDb, /process\.env\.DATABASE_URL/);

  // The three must agree with each other *and* with the path the image already
  // defaults to. A Dockerfile ENV, a compose default and a litestream literal
  // can each look right alone and still point at three different files.
  const imageDefault = dockerfile.match(/^ENV DATABASE_URL=(\S+)$/m)?.[1];
  const composeDefault = compose.match(/DATABASE_URL=\$\{DATABASE_URL:-([^}]+)\}/)?.[1];
  assert.equal(imageDefault, '/app/data/app.db', 'the image must default the database path');
  assert.equal(
    composeDefault,
    imageDefault,
    'compose must pass the same default the image declares, or a deploy with no .env entry diverges'
  );

  // Compose has to interpolate it, or "set DATABASE_URL in .env" cannot move the
  // database at all and the other two files were fixed for nothing.
  assert.match(
    compose,
    /- DATABASE_URL=\$\{DATABASE_URL:-/,
    'compose must let .env override the database location'
  );
  // Absolute, because a relative path is resolved by the app against its own
  // working directory and by Litestream against its own.
  assert.ok(imageDefault.startsWith('/'), 'litestream cannot be trusted with a relative database path');
});

test('the three local fallbacks are one value, not three hand-copied literals', () => {
  // The check above pins the *container* path — the image's ENV, compose's
  // default, litestream, the CMD — and it does assert that src/db/index.ts and
  // scripts/init-db.mjs read process.env.DATABASE_URL. But not what either does
  // when the variable is ABSENT, which is the only case that ever fires: inside
  // the container the image's ENV always supplies the value, so the fallback is
  // reachable exclusively from a local `npm run dev` or `npm run db:push`.
  //
  // That answer was a hand-copied literal in three files, none of them pinned.
  // Edit one — the most natural place being the dev-only path you happen to be
  // looking at — and `npm run dev` opens one file while `npm run db:push`
  // (drizzle.config.ts) migrates a different one. The app then serves a schema
  // the migrations never touched. Same drift as the bug above, one layer down,
  // passing every other assertion in this file.
  //
  // Equal to each other, and deliberately NOT to the image default: these are
  // relative so they resolve against the repo root locally, whereas Litestream
  // resolves a relative path against its own working directory — which is
  // exactly why the container path above has to stay absolute.
  const sources = {
    'src/db/index.ts': readFileSync(join(root, 'src/db/index.ts'), 'utf8'),
    'scripts/init-db.mjs': readFileSync(join(root, 'scripts/init-db.mjs'), 'utf8'),
    'drizzle.config.ts': readFileSync(join(root, 'drizzle.config.ts'), 'utf8'),
  };

  const fallbacks = Object.entries(sources).map(([name, src]) => {
    // Matched rather than imported: these three are not importable from a
    // node --test run (two are not even TS), and the value is a literal either
    // way. The `||` matters — `??` would mean a different thing here.
    const m = src.match(/process\.env\.DATABASE_URL\s*\|\|\s*'([^']+)'/);
    assert.ok(m, `${name} no longer falls back to a literal — this test needs revisiting`);
    return [name, m[1]] as const;
  });

  // Stated per file so a drift names the odd one out instead of reporting
  // "expected one value, received three" and leaving the reader to work out
  // which is wrong.
  const [firstName, firstValue] = fallbacks[0];
  for (const [name, value] of fallbacks.slice(1)) {
    assert.equal(
      value,
      firstValue,
      `${name} falls back to ${value} but ${firstName} uses ${firstValue}`
    );
  }
});

test('the shipped defaults leave replication off', () => {
  // The other direction of parity, and the one that was missing. Making every
  // documented variable reach the container is only half the job: what it
  // ships *with* now decides what a default deploy turns on.
  //
  // LITESTREAM_BUCKET is a bare shell test in the start command —
  // `[ -n "$LITESTREAM_BUCKET" ]` — with no placeholder guard of its own.
  // Stripe has `isRealSecret` for exactly this: `sk_test_51...` in this file is
  // recognised as fake, the client is null, and checkout stays off. Litestream
  // has no equivalent, so the value IS the switch. It shipped as
  // `litesaas-db-backups`, which reads as a suggestion rather than as a switch
  // nobody threw — and the endpoint and keys beside it were still this file's
  // placeholders, so `cp .env.example .env && docker compose up` (README steps
  // 2 and 3, the whole Quick Start) reached for S3 with `your_r2_access_key`
  // instead of reaching `next start`.
  assert.equal(shipped('LITESTREAM_BUCKET'), '', 'a non-empty bucket switches replication on at every start');

  // The rest of the Litestream set is inert while the bucket is empty, so its
  // placeholder values are documentation rather than a hazard — but they must
  // still be documented as such, not look like live credentials.
  for (const name of ['LITESTREAM_ENDPOINT', 'LITESTREAM_ACCESS_KEY_ID', 'LITESTREAM_SECRET_ACCESS_KEY']) {
    assert.ok(shipped(name), `${name} should still ship a documented placeholder`);
  }

  // The compose entry must default to empty too, or an operator who deletes the
  // line from .env gets whatever the compose file says rather than "off".
  assert.match(
    compose,
    /LITESTREAM_BUCKET=\$\{LITESTREAM_BUCKET:-\}/,
    'compose must pass an unset bucket through as empty, not substitute a name'
  );
});

test('every build arg is promoted to an ENV, or Next inlines nothing', () => {
  // Compose passes these as build args, and the Dockerfile ARGs them — both
  // directions are checked above. What is not checked is the step between: an
  // ARG exists only to be read by a later instruction, and declaring one puts
  // nothing in the build environment. Delete the ENV line and the build
  // succeeds, the ARG is still "declared", and the value inlines as empty.
  //
  // For the app URL that means billing.ts refuses to take money at all — its
  // origin guard rejects `http://localhost:3000` in production, so every
  // checkout answers `?billing=appurl` while the operator's .env is right there.
  // For the price id it means the checkout branch is never entered, so the
  // dashboard shows `?billing=price` naming a variable they did set. Both are
  // silent: nothing in the image records that the value was ever passed.
  const promoted = new Set(
    [...dockerfile.matchAll(/^ENV ([A-Z][A-Z0-9_]*)=\$[A-Z][A-Z0-9_]*$/gm)].map((m) => m[1])
  );
  // Filtered from the ARG list, so a new build-time variable adds its own
  // requirement rather than needing this file edited again.
  const buildTime = buildArgNames.filter((name) => name.startsWith('NEXT_PUBLIC_'));
  assert.ok(buildTime.length > 0, 'no NEXT_PUBLIC_* build args parsed — the scan is broken');

  const unpromoted = buildTime.filter((name) => !promoted.has(name));
  assert.deepEqual(
    unpromoted,
    [],
    `ARG'd but never ENV'd, so it inlines empty: ${unpromoted.join(', ')}`
  );

  // …and each ENV carries its own ARG's value. `ENV
  // NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL` reads as noise that a bad merge
  // could just as easily turn into `ENV NEXT_PUBLIC_APP_URL=`.
  for (const name of buildTime) {
    assert.match(
      dockerfile,
      new RegExp(`^ENV ${name}=\\$${name}$`, 'm'),
      `${name} must be carried into the build environment from its own ARG`
    );
  }
});

test('the runner holds everything the start command executes', () => {
  // The CMD is a shell line naming a binary, a script and a config. Each is
  // fetched by a COPY, and a COPY is a line nothing pins: drop one and the image
  // builds perfectly, then the container dies on its first command with a
  // missing-file error that says nothing about a missing layer.
  //
  // `scripts/` is the one that matters most. init-db.mjs is the only place the
  // schema is applied in a Docker deploy — `db:push` never runs there — so a
  // runner without it cannot start at all, on every deploy, not just the drifted
  // ones.
  const runner = dockerfile.slice(dockerfile.indexOf('FROM base AS runner'));
  assert.ok(runner.length > 0, 'the runner stage is gone; this test needs revisiting');

  for (const path of ['scripts', 'litestream\\.yml', '\\.next', 'public']) {
    assert.match(runner, new RegExp(`^COPY .*${path}`, 'm'), `${path} is used at start but never copied`);
  }

  // The config goes to /etc/litestream.yml because the CMD names that path. The
  // two have to agree: a config copied anywhere else is one litestream cannot
  // find, and it exits before the app is ever exec'd.
  assert.match(
    CMD_LINE,
    /-config \/etc\/litestream\.yml/,
    'the CMD must name the path the config is copied to'
  );
  assert.match(
    runner,
    /^COPY litestream\.yml \/etc\/litestream\.yml$/m,
    'the config must land at the path the CMD passes to litestream'
  );
});

test('a first deploy can boot with an empty backup bucket', () => {
  // `-if-replica-exists` is what makes the restore a no-op rather than a
  // failure when the bucket holds nothing — which is the state of every brand
  // new deployment on the run where an operator fills in the Litestream
  // variables and restarts. Without it litestream exits non-zero, the CMD's `&&`
  // chain aborts, and the app never starts. The operator turned on backups and
  // got a container that will not boot, on exactly the deploy that asked for
  // the protection.
  //
  // The flag belongs on the restore and nowhere else: the replicate that follows
  // is the thing creating the first replica, so it has nothing to skip.
  assert.match(
    CMD_LINE,
    /litestream restore -if-replica-exists\b/,
    'restoring from a bucket with no replica yet must not fail the boot'
  );
  assert.doesNotMatch(
    CMD_LINE,
    /litestream replicate -if-replica-exists/,
    'the replicate is what creates the first replica; it has nothing to skip'
  );
});

test('every credential in the backup config stays a variable', () => {
  // Self-hosted S3 — R2, MinIO, Backblaze — is the reason LITESTREAM_ENDPOINT
  // exists at all, and the placeholders .env.example ships are an R2 key. A
  // literal here is a working configuration that quietly stops following .env:
  // the operator rotates a key, replication keeps authenticating with the old
  // one, and the symptom is a 403 in a log nobody reads until the day they need
  // a restore. Then there is no restore.
  //
  // Derived from the keys in the file, so a credential added later is covered
  // without editing this test.
  const config = readFileSync(join(root, 'litestream.yml'), 'utf8');
  const values = [
    ...config.matchAll(
      /^\s*(bucket|endpoint|access-key-id|secret-access-key|path):\s*"?(.*?)"?\s*$/gm
    ),
  ];
  assert.ok(values.length >= 4, `expected the credential set, parsed ${values.length}`);

  for (const [, key, value] of values) {
    // The replica `path` is the deployment's own naming, not an operator knob —
    // it is pinned by the assertions below. `${DATABASE_URL}` is a different line
    // entirely (`- path:` does not match this pattern).
    if (key === 'path') continue;
    assert.match(
      value,
      /^\$\{[A-Z][A-Z0-9_]*\}$/,
      `${key} must read from the environment rather than a literal: ${value}`
    );
  }

  // The promise the whole file exists to keep: what a restore looks for, and how
  // much data a crash costs. Neither is a process.env read anywhere in the
  // repository, so the parity test above cannot see them.
  assert.match(config, /path: "backups\/app\.db"/, 'the replica path an existing deployment restores from');
  assert.match(config, /sync-interval: 1s/, 'the recovery point objective this configuration advertises');
});

// ---------------------------------------------------------------------------
// The startup guard: a half-configured backup is refused rather than ignored.
// ---------------------------------------------------------------------------
//
// Every other assertion in this file reads the Dockerfile as text, because
// `npm test` runs no Docker. This one does not have to: the guard is `sh`, and
// `sh` is right here. So the CMD is parsed out of the Dockerfile and the guard
// is *executed* under each configuration — the only way to be sure the shell
// syntax is valid, since a typo inside a `{ …; } ||` group is not a finding any
// regex can report.
//
// The failure it covers is invisible from outside the container. Until the
// guard existed, $LITESTREAM_BUCKET alone decided whether any backup happened:
// set it without the credentials beside it and litestream ships nothing; set
// the credentials without it and the CMD skips replication entirely. Either way
// the container serves traffic, restarts clean, and has never backed up — and
// neither prints an error, because no code path fails. For a backup that is the
// worst available outcome: the operator finds out on the day they need one.

/** The CMD's arguments, with the exec-form JSON itself proved well-formed. */
const cmdArgv = (): string[] => {
  const from = CMD_LINE.indexOf('[');
  assert.ok(from > -1, 'the Dockerfile has no exec-form CMD array');
  const argv = JSON.parse(CMD_LINE.slice(from)) as unknown;
  assert.ok(
    Array.isArray(argv) && argv[0] === 'sh' && argv[1] === '-c',
    'the CMD is no longer `sh -c "<script>"`, so this section cannot locate the guard'
  );
  return argv as string[];
};

const script = cmdArgv()[2];

/**
 * Just the guards: everything before the first command that would do real work.
 *
 * Slicing at the `if` that guards the restore rather than running the whole
 * CMD is deliberate. The rest of the script starts Next, opens the database
 * and forks the replicator; this section asserts about the *decision*, and
 * running the decision is enough. `litestream` is also not on the test
 * machine's PATH, so a slice reaching further would fail for a reason
 * unrelated to the guard.
 *
 * Slicing at the *statement* matters, not at the `litestream restore` word
 * inside it. Cut at the word instead and the leftover `if [ -n … ]; then` has
 * no `fi`, which `sh` reports as a syntax error and exits 2 — so the guard
 * looks like it refuses everything for a reason that has nothing to do with
 * the configuration under test.
 */
const guard = (() => {
  const at = script.search(/if \[ -n "\$LITESTREAM_BUCKET" \]; then litestream restore/);
  assert.ok(at > -1, 'the CMD no longer guards the restore the same way — this slice is stale');
  return script.slice(0, at);
})();

/** Run the guard with exactly these variables set, and nothing else inherited. */
function runGuard(set: Record<string, string>): { code: number; stderr: string } {
  // A minimal env, not process.env: a developer who exports LITESTREAM_BUCKET
  // in their shell would otherwise decide two of these cases for us, for reasons
  // that have nothing to do with the Dockerfile.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', NODE_ENV: 'test' };
  for (const [name, value] of Object.entries(set)) env[name] = value;
  try {
    const stdout = execFileSync('sh', ['-c', guard], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: String(stdout) };
  } catch (err) {
    const e = err as { status?: number | null; stderr?: Buffer };
    return { code: e.status ?? -1, stderr: String(e.stderr ?? '') };
  }
}

const BUCKET = 'LITESTREAM_BUCKET';
const ENDPOINT = 'LITESTREAM_ENDPOINT';
const KEY_ID = 'LITESTREAM_ACCESS_KEY_ID';
const SECRET = 'LITESTREAM_SECRET_ACCESS_KEY';
const FULL = { [BUCKET]: 'b', [ENDPOINT]: 'e', [KEY_ID]: 'k', [SECRET]: 's' };

test('a complete backup starts, and an absent one stays a supported default', () => {
  // Both silent. Absent is LiteSaaS out of the box — option A is a complete
  // deployment with no S3 at all — so refusing to start there would break every
  // default install to catch a mistake nobody made.
  for (const [label, set] of [
    ['complete', FULL],
    ['absent', {} as Record<string, string>],
  ] as const) {
    const { code, stderr } = runGuard(set as Record<string, string>);
    assert.equal(code, 0, `the guard refuses a ${label} configuration: ${stderr}`);
    assert.equal(stderr.trim(), '', `a ${label} configuration warned about nothing actionable`);
  }
});

test('a bucket without credentials is refused, not silently ignored', () => {
  // The half that matters most: the operator believes they configured backups,
  // and litestream can neither authenticate nor upload.
  for (const missing of [ENDPOINT, KEY_ID, SECRET]) {
    const set: Record<string, string> = { ...FULL };
    delete set[missing];
    const { code, stderr } = runGuard(set);
    assert.equal(code, 1, `${BUCKET} without ${missing} started with no backup configured`);
    assert.match(stderr, /LITESTREAM_BUCKET/, 'the refusal does not say which variable is at fault');
    assert.match(
      stderr,
      /nothing in this container would say so/,
      'the refusal must explain that this is a silent failure being prevented'
    );
  }
});

test('credentials without a bucket are refused — that half runs no backup code at all', () => {
  // Strictly worse than the case above: the CMD's own `[ -n "$LITESTREAM_BUCKET" ]`
  // test is false, so it skips both the restore and the replicate. Not a failed
  // replication — no replication is ever attempted, and nothing logs an error.
  for (const orphan of [ENDPOINT, KEY_ID, SECRET]) {
    const { code, stderr } = runGuard({ [orphan]: 'x' });
    assert.equal(code, 1, `${orphan} alone started a deployment with no backup configured`);
    assert.match(
      stderr,
      new RegExp(`${BUCKET} is not`),
      'the refusal does not name the variable whose absence is the problem'
    );
  }
});