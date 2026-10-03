import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.ts';
import { subscriptions, users } from '../src/db/schema.ts';

// Run: npm test
//
// The bug this prevents: checkoutNonce read `lemonNonce`, and on the first
// click found null, minted one, and wrote it. Sequential reuse was already
// handled and was already tested — four clicks in a row share one nonce. What
// no test could see is the same function called twice at once: a double-click, a
// second tab, a retried POST. Both read the null before either has written, so
// both mint, and the second write overwrites the first. The first checkout is
// at LemonSqueezy by then carrying a nonce that is on no row anywhere, so the
// customer pays on it, the webhook's findFirst resolves it to nothing, and the
// route answers `skipped: no subscription` with a 200. Paid, no Pro, and
// nothing anywhere says so.
//
// Sequential tests cannot produce this: the second call has to await the first,
// and by then the value is there. It has to be two calls genuinely in flight,
// which is why these run against a real database rather than reading the source.
//
// This is the same defect, and the same fix, as the read-then-write in
// toggleProjectStatusAction: let SQLite arbitrate the write instead of having
// both requests decide independently.

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dir = mkdtempSync(join(tmpdir(), 'litesaas-nonce-'));
const dbPath = join(dir, 'race.db');

// init-db.mjs reads the path from env on import and runs top-level.
process.env.DATABASE_URL = dbPath;
await import('../scripts/init-db.mjs');

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });
const userId = 'user_nonce';

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

await db.insert(users).values({ id: userId, email: 'nonce@t.test', name: 'Nonce', passwordHash: 'x' });

const reset = async () => {
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await db
    .insert(subscriptions)
    .values({ id: `sub_${userId}`, userId, plan: 'free', status: 'active' });
};

const nonceOn = async () =>
  (await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) }))!.lemonNonce;

/**
 * The shipped function, statement for statement.
 *
 * Copied rather than imported because `billing.ts` is `'use server'` and pulls in
 * next/headers, so it cannot be loaded under `node --test` — the same reason
 * tests/server-action-contracts.test.ts reads it as source. The source-shape
 * assertions at the bottom are what keep this copy honest: they fail if billing.ts
 * stops matching what runs here.
 */
async function mint(userIdToMint: string): Promise<string> {
  const row = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userIdToMint) });
  if (row?.lemonNonce) return row.lemonNonce;

  const nonce = crypto.randomBytes(32).toString('hex');
  const won = await db
    .update(subscriptions)
    .set({ lemonNonce: nonce })
    .where(and(eq(subscriptions.userId, userIdToMint), isNull(subscriptions.lemonNonce)));

  if (won.changes === 1) return nonce;

  const winner = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userIdToMint) });
  return winner?.lemonNonce ?? nonce;
}

test('two checkouts started at once both carry a nonce the webhook can match', async () => {
  await reset();

  // Promise.all, not two awaits: the second call has to be in flight before the
  // first has written, which is the whole condition. A sequential pair cannot
  // fail here and would pass on the old code too.
  const [a, b] = await Promise.all([mint(userId), mint(userId)]);
  const stored = await nonceOn();

  assert.equal(stored, a, 'the first checkout\'s nonce is on no row; a payment on it resolves to nothing');
  assert.equal(stored, b, 'the second checkout\'s nonce is on no row');
  assert.match(a, /^[0-9a-f]{64}$/, 'a minted nonce is 32 random bytes, hex');
});

test('without the guarded write the same race orphans a checkout', async () => {
  // The control, and the reason the first test is not vacuous. If this stops
  // failing, the guard is no longer doing anything.
  await reset();

  const unguarded = async (userIdToMint: string): Promise<string> => {
    const row = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userIdToMint) });
    if (row?.lemonNonce) return row.lemonNonce;
    const nonce = crypto.randomBytes(32).toString('hex');
    await db
      .update(subscriptions)
      .set({ lemonNonce: nonce })
      .where(eq(subscriptions.userId, userIdToMint));
    return nonce;
  };

  const [a, b] = await Promise.all([unguarded(userId), unguarded(userId)]);
  const stored = await nonceOn();

  assert.notEqual(a, b, 'both calls minted independently');
  // Which of the two wins is not deterministic — both callers are past the read
  // and racing to the write, and last-write-wins is decided by SQLite, not by
  // this test. So the claim is the invariant rather than an ordering: exactly
  // one checkout is left carrying a nonce that is on no row, and a customer who
  // pays on that one is the bug. Asserting *which* one would make this test
  // flaky rather than stronger.
  assert.ok(stored === a || stored === b, 'one of the two writes should have won');
  assert.equal(
    [a, b].filter((n) => n !== stored).length,
    1,
    'exactly one checkout should be orphaned — paying on it resolves to no subscription'
  );
});

test('a later click still reuses the nonce rather than minting another', async () => {
  // The sequential property the guarded write must not have broken: a refund
  // arrives days later and has to match the same row, so the nonce outlives the
  // checkout rather than rotating per attempt.
  await reset();

  const first = await mint(userId);
  const second = await mint(userId);
  const third = await mint(userId);

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(await nonceOn(), first);
});

test('the guarded write and the re-read are what shipping actually does', async () => {
  // The copy above is only evidence about the copy. These pin the two halves of
  // the fix in billing.ts itself, so the behaviour cannot be left behind by an
  // edit to the function.
  const billing = readFileSync(fileURLToPath(new URL('../src/app/actions/billing.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const start = billing.indexOf('async function checkoutNonce');
  assert.notEqual(start, -1, 'checkoutNonce is gone; this test needs revisiting');
  const fn = billing.slice(start, billing.indexOf('export async function upgradeToProAction'));

  // The write must be conditional, or the second caller overwrites the first.
  // `WHERE user_id = ?` alone is what orphans the earlier checkout.
  assert.match(
    fn,
    /isNull\(subscriptions\.lemonNonce\)/,
    'the mint must only write a row that has no nonce yet'
  );

  // And the loser must read back the winner's value rather than returning its
  // own. `if (won.changes === 1) return nonce;` with no re-read afterwards is
  // the guard without the recovery: the write is protected, the returned value
  // is not, and the orphaned checkout comes straight back.
  assert.match(fn, /won\.changes === 1/, 'the write must report whether it won');
  const reRead = fn.indexOf('won.changes === 1');
  const readBack = fn.indexOf('db.query.subscriptions.findFirst', reRead);
  assert.ok(readBack > reRead, 'a lost race must re-read the row and return the nonce that is on it');
  assert.ok(
    fn.indexOf('return winner?.lemonNonce') > readBack,
    'the re-read value is what must be returned, not the freshly minted nonce'
  );

  // The early return for an existing nonce is the reuse path, and it is what
  // keeps a second click from minting at all.
  assert.match(fn, /if \(row\?\.lemonNonce\) return row\.lemonNonce;/);
});