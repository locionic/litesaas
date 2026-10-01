import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { isStaleEvent, notStaleSql, CLOCK_SKEW_GRACE_SECONDS } from '../src/lib/webhook-guard.ts';
import * as schema from '../src/db/schema.ts';
import { subscriptions, users } from '../src/db/schema.ts';

// Run: npm test
//
// The bug this prevents: a `subscription_created` delivery is queued because
// the handler 500'd (a transient SQLITE_BUSY is enough), the user cancels while
// it is queued, `subscription_cancelled` lands first and correctly revokes, and
// then the queued `subscription_created` retry arrives and flips the row back
// to Pro. The subscription is already over, so nothing ever arrives to undo it —
// permanently free Pro with no code path that can ever revoke it.

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const at = (ms: number) => new Date(ms);
const unix = (ms: number) => Math.floor(ms / 1000);

test('an event newer than the row applies', () => {
  assert.equal(isStaleEvent(unix(NOW + 5_000), at(NOW)), false);
});

test('an event older than the row is stale', () => {
  // Queued before the revocation, delivered after it. Applying it resurrects
  // the subscription, which is the permanent-corruption case.
  assert.equal(isStaleEvent(unix(NOW - 3 * 60 * 60 * 1000), at(NOW)), true);
});

test('a row with nothing applied yet always accepts', () => {
  assert.equal(isStaleEvent(unix(NOW), null), false);
  assert.equal(isStaleEvent(unix(NOW), undefined), false);
});

test('same-second events survive clock skew', () => {
  // Signing up and paying inside one second is normal. The provider's event
  // can be a fraction of a second older than the row's updatedAt, and dropping
  // that grant would lose a real customer.
  const justAfter = NOW + 400;
  assert.equal(isStaleEvent(unix(justAfter), at(justAfter)), false);
  assert.equal(isStaleEvent(unix(NOW - 1_000), at(NOW)), false, '1s behind must still apply');
  assert.equal(
    isStaleEvent(unix(NOW - CLOCK_SKEW_GRACE_SECONDS * 1000), at(NOW)),
    false,
    'exactly at the grace edge still applies'
  );
  assert.equal(
    isStaleEvent(unix(NOW - (CLOCK_SKEW_GRACE_SECONDS + 2) * 1000), at(NOW)),
    true,
    'past the edge is stale'
  );
});

test('an event stamped in the future is not treated as stale', () => {
  assert.equal(isStaleEvent(unix(NOW + 60_000), at(NOW)), false);
});

test('garbage input never blocks a mutation', () => {
  // Fail open on nonsense: a malformed timestamp must not silently discard a
  // legitimate billing event.
  assert.equal(isStaleEvent(NaN, at(NOW)), false);
  assert.equal(isStaleEvent(unix(NOW - 86_400_000), 'not-a-date' as unknown as Date), false);
});

test('accepts a numeric timestamp as well as a Date', () => {
  // Don't depend on the driver handing back a Date rather than a number.
  assert.equal(isStaleEvent(unix(NOW - 3 * 60 * 60 * 1000), NOW), true);
  assert.equal(isStaleEvent(unix(NOW + 1_000), NOW), false);
});

// The read that drives isStaleEvent is only valid until the next await, and both
// providers deliver concurrently as well as out of order. So the guard is also
// written into each UPDATE's WHERE. These run against a real database, because
// the property that matters is not the SQL's shape but that a lost race updates
// nothing at all.

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dir = mkdtempSync(join(tmpdir(), 'litesaas-guard-'));
const dbPath = join(dir, 'race.db');

// init-db.mjs reads the path from env on import and runs top-level.
process.env.DATABASE_URL = dbPath;
await import('../scripts/init-db.mjs');

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });
const userId = 'user_race';

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

await db.insert(users).values({ id: userId, email: 'race@t.test', name: 'Race', passwordHash: 'x' });

/** One subscription in the state every case starts from. */
const reset = async () => {
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await db.insert(subscriptions).values({ id: `sub_${userId}`, userId, plan: 'free', status: 'active' });
};

const planOf = async () => (await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) }))!;

/** The two statements a webhook handler runs, with the watermark in the WHERE. */
const apply = (eventCreated: number, patch: { plan: 'free' | 'pro'; status: 'canceled' | 'active' }) =>
  db
    .update(subscriptions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(subscriptions.userId, userId), notStaleSql(subscriptions.updatedAt, eventCreated)));

test('a stale event loses the race and changes nothing', async () => {
  await reset();
  const now = unix(Date.now());

  // The revocation lands first and is correctly applied.
  await apply(now, { plan: 'free', status: 'canceled' });
  assert.equal((await planOf()).plan, 'free', 'the revocation itself must apply');

  // The queued grant from an hour ago arrives while both requests are in flight.
  const written = await apply(now - 3600, { plan: 'pro', status: 'active' });
  assert.equal(written.changes, 0, 'the older event must update no rows');
  assert.equal((await planOf()).plan, 'free', 'and must not resurrect the subscription');
});

test('without the watermark the same race does resurrect it', async () => {
  // The control. If this ever stops corrupting the row, the test above has
  // stopped proving anything and is passing for the wrong reason.
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await reset();
  const now = unix(Date.now());

  await db
    .update(subscriptions)
    .set({ plan: 'free', status: 'canceled', updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));

  await db
    .update(subscriptions)
    .set({ plan: 'pro', status: 'active', updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId)); // no watermark — the old code

  assert.equal((await planOf()).plan, 'pro', 'an unguarded write flips it back to Pro');
});

test('a current event still applies', async () => {
  await reset();

  const written = await apply(unix(Date.now()), { plan: 'pro', status: 'active' });
  assert.equal(written.changes, 1);
  assert.equal((await planOf()).plan, 'pro');
});

test('a same-second event is not mistaken for stale', async () => {
  // The clock-skew case: signup, pay and record can all land inside one second,
  // and the watermark comparison must not read that as an older event.
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await reset();
  const now = unix(Date.now());

  await apply(now, { plan: 'pro', status: 'active' });
  // Second delivery of the same event, replayed by the provider.
  const replay = await apply(now, { plan: 'pro', status: 'active' });
  assert.equal(replay.changes, 1, 'a replayed event still matches the watermark');
});

test('a garbage timestamp fails open', async () => {
  // `and()` drops undefined, so a missing created_at costs the watermark and
  // nothing else — the same fail-open the boolean form keeps. Silently
  // discarding a billing event would be worse than applying an unordered one.
  await reset();

  const written = await apply(NaN, { plan: 'pro', status: 'active' });
  assert.equal(written.changes, 1);
});

test('the watermark is dropped entirely for a garbage timestamp', () => {
  const sql = db
    .update(subscriptions)
    .set({ plan: 'pro' })
    .where(and(eq(subscriptions.userId, 'x'), notStaleSql(subscriptions.updatedAt, NaN)))
    .toSQL();
  assert.doesNotMatch(sql.sql, /updated_at/);
  assert.equal(notStaleSql(subscriptions.updatedAt, Number.POSITIVE_INFINITY), undefined);
});

test('the watermark compares against the event time plus the skew grace', () => {
  // Not against the bare event time: that is the bug the grace exists for.
  const sql = db
    .update(subscriptions)
    .set({ plan: 'pro' })
    .where(and(eq(subscriptions.userId, 'x'), notStaleSql(subscriptions.updatedAt, unix(NOW))))
    .toSQL();
  assert.match(sql.sql, /"updated_at" <=/);
  assert.ok(sql.params.includes(unix(NOW) + CLOCK_SKEW_GRACE_SECONDS));
});
test('every mutating webhook update carries the watermark', () => {
  // The behavioural tests above prove notStaleSql works; nothing else stops a
  // later edit from dropping it from a handler and silently reopening the race.
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  for (const rel of [
    '../src/app/api/webhooks/stripe/route.ts',
    '../src/app/api/webhooks/lemonsqueezy/route.ts',
  ]) {
    const body = read(rel);
    // Slice at each update so a new arm cannot slip in without the guard.
    const arms = body.split('.update(subscriptions)').slice(1);
    assert.ok(arms.length > 0, `${rel}: found no mutating arms to check`);
    for (const [i, arm] of arms.entries()) {
      assert.match(
        arm,
        /notStaleSql\(/,
        `${rel} arm ${i + 1} updates without the watermark in its WHERE`
      );
    }
  }
});
