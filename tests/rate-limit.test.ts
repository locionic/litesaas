import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRateLimit, resetRateLimit, clearRateLimits } from '../src/lib/rate-limit.ts';

// Run: npm test

test('allows exactly `limit` attempts, then blocks', () => {
  clearRateLimits();
  const results = Array.from({ length: 6 }, () => checkRateLimit('k1', 5));
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, true, true, true, false]
  );
});

test('reports seconds remaining on a blocked attempt', () => {
  clearRateLimits();
  checkRateLimit('k2', 1, 60_000);
  const blocked = checkRateLimit('k2', 1, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
});

test('keys are independent', () => {
  clearRateLimits();
  for (let i = 0; i < 3; i++) checkRateLimit('a', 2);
  assert.equal(checkRateLimit('a', 2).ok, false, 'a should be throttled');
  assert.equal(checkRateLimit('b', 2).ok, true, 'b must be unaffected');
});

test('reset clears a counter after success', () => {
  clearRateLimits();
  checkRateLimit('c', 2);
  checkRateLimit('c', 2);
  assert.equal(checkRateLimit('c', 2).ok, false);
  resetRateLimit('c');
  assert.equal(checkRateLimit('c', 2).ok, true, 'a successful auth must not stay throttled');
});

test('the window expires', () => {
  // 60ms, not 1ms. The 1ms version was correct on an idle machine and flaky in
  // the suite: `node --test` runs every file concurrently, so the two calls
  // below have to land within one millisecond of each other while 27 other
  // processes compete for the CPU. It went red once in eleven full runs, and a
  // test that fails at random is a test people learn to re-run instead of read
  // — which is worse than not having it.
  //
  // The property under test is unchanged. 60ms gives the first assertion sixty
  // times the headroom while staying far too short for the once-a-second sweep
  // to have run, which is what the comment below turns on.
  const WINDOW_MS = 60;
  clearRateLimits();
  const started = Date.now();
  checkRateLimit('d', 1, WINDOW_MS);
  assert.equal(checkRateLimit('d', 1, WINDOW_MS).ok, false, 'the window has not elapsed yet');
  // Wait out the window. The sweep is throttled to once a second, so it has
  // almost certainly NOT run for this key — the inline `resetAt <= now` check
  // in checkRateLimit is what has to release it. Lockout correctness must not
  // depend on sweep timing.
  const until = Date.now() + WINDOW_MS + 30;
  while (Date.now() < until) {
    /* spin */
  }
  assert.equal(checkRateLimit('d', 1, WINDOW_MS).ok, true, 'bucket must be reclaimed after the window');

  // Self-guarding, and the reason this test is not just "make the numbers
  // bigger". If WINDOW_MS is ever raised past the sweep interval, the bucket
  // would be released by the sweep instead, and this would still pass with
  // checkRateLimit's inline `resetAt <= now` check deleted — testing the sweep's
  // timing while claiming to test the lockout rule. Asserting the elapsed time
  // turns that from a thing I reasoned about into a thing that fails.
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed < 1000,
    `${elapsed}ms elapsed — the once-a-second sweep may have run, so this is no longer testing the inline check`
  );
});

test('the default window is minutes, not seconds', () => {
  // `checkRateLimit` takes a `windowMs` so a test can use a short one, and every
  // case above passes one — which left the default, the only value loginAction and
  // registerAction ever get, entirely unpinned. `15 * 1000` for `15 * 60 * 1000`
  // is a one-character edit that every test in this file survives: the limit still
  // blocks, it just releases after fifteen seconds. Password guessing goes from
  // 10 attempts a quarter hour to 40 a minute, and the sign-in lockout stops
  // being a lockout.
  //
  // Observable without waiting: the blocked attempt reports how much of the window
  // is left, which is the window itself.
  clearRateLimits();
  checkRateLimit('default-window', 1);
  const blocked = checkRateLimit('default-window', 1);
  assert.equal(blocked.ok, false);
  assert.ok(
    blocked.retryAfterSeconds > 600,
    `the default window is ${blocked.retryAfterSeconds}s; sign-in is locked for 15 minutes`
  );
});

test('expired buckets are reclaimed, and the sweep is throttled', () => {
  // Source-asserted because the Map is not observable from outside. Nothing
  // exported reports its size, and a bucket only becomes visible again by being
  // looked up — which `checkRateLimit` already does lazily, on its own, whether or
  // not the sweep has run. So the sweep can be deleted outright and every
  // behavioural test above still passes. They would: the lazy check is the one
  // that decides whether a bucket has expired, which is why throttling the sweep
  // can never extend a lockout.
  //
  // It is still load-bearing, for memory. `login:ip:${ip}` and `login:email:${email}`
  // are keys a caller chooses, so an unauthenticated flood creates one bucket per
  // request and nothing else ever removes one that is not revisited. Unreclaimed,
  // the Map grows until the process is killed — a denial of service that needs no
  // valid credentials to begin.
  //
  // Which is also why the interval is bounded below rather than merely non-zero.
  // The sweep walked every live key, so running it per call under a key flood is
  // n buckets scanned per request — quadratic work driven by unauthenticated
  // input, which is the same DoS by another route.
  const src = readFileSync(fileURLToPath(new URL('../src/lib/rate-limit.ts', import.meta.url)), 'utf8');

  assert.match(src, /sweepIfDue\(now\);/, 'checkRateLimit no longer sweeps at all; buckets grow forever');

  // The guard has to be asserted, not inferred from the call above it. `sweepIfDue`
  // being called says nothing about whether it does anything: replacing the guard
  // with a bare `return` leaves the call, the interval and the loop all in place
  // and the sweep permanently dead, which passed this test until it didn't.
  assert.match(
    src,
    /if \(now - lastSweep < SWEEP_INTERVAL_MS\) return;/,
    'the sweep is throttled by its interval, not short-circuited away'
  );

  const every = src.match(/const SWEEP_INTERVAL_MS = (\d+)/);
  assert.ok(every, 'the sweep interval is gone; this test needs revisiting');
  assert.ok(
    Number(every[1]) >= 100,
    `a ${every[1]}ms sweep walks every key per request — quadratic under a key flood`
  );

  assert.match(
    src,
    /if \(bucket\.resetAt <= now\) buckets\.delete\(key\);/,
    'the sweep runs but reclaims nothing'
  );
});

test('the throttle records when it last ran, so the guard means something', () => {
  // The two assertions above are about the guard and the interval; neither is
  // about the guard being live. Delete `lastSweep = now` and the guard is still
  // there, the interval is still 1000ms, the call and the loop are all still in
  // place — and the sweep now runs on every single call, which is precisely the
  // quadratic-per-request shape the comment three assertions up describes.
  //
  // Nothing behavioural can see this: the Map is not observable, and reclaiming
  // an expired bucket twice is idempotent. The symptom is memory and CPU under
  // an unauthenticated key flood, which is exactly the situation the sweep
  // exists to survive.
  //
  // Asserted inside the function body rather than file-wide, because a
  // `lastSweep = now` anywhere else — a comment, a test seam — would satisfy a
  // search over the whole file and leave the real one untouched.
  const src = readFileSync(fileURLToPath(new URL('../src/lib/rate-limit.ts', import.meta.url)), 'utf8');
  const from = src.indexOf('function sweepIfDue(');
  assert.notEqual(from, -1, 'sweepIfDue is gone; this test needs revisiting');
  const to = src.indexOf('\n}', from);
  assert.ok(to > from, 'sweepIfDue has no closing brace');

  const body = src.slice(from, to);
  assert.match(body, /lastSweep = now;/, 'the sweep never records that it ran, so it never throttles');

  // …and it has to be recorded, not merely mentioned: the assignment is what
  // `clearRateLimits` resets, so it has to be the same variable the guard reads.
  const guard = body.match(/now - (\w+) < SWEEP_INTERVAL_MS/);
  assert.ok(guard, 'the throttle guard no longer compares against a timestamp');
  assert.match(body, new RegExp(`\\b${guard[1]} = now;`), `the guard reads ${guard[1]}, which is never assigned`);
});

test('the bucket map is cached on global in development only', () => {
  // The same idiom as the SQLite handle in src/db/index.ts, with the same reason
  // to be pinned: `next dev` re-evaluates this module on every save, so without
  // the global each save hands every visitor a fresh empty Map and every rate
  // limit resets. That half is the benefit.
  //
  // The other half is invisible. Publishing the Map in production means one
  // shared, never-replaced collection outliving whatever module scope made it,
  // and no test can observe that — which is the situation the SQLite handle is
  // pinned in db-pragmas.test.ts for, and it is the same code shape.
  const src = readFileSync(fileURLToPath(new URL('../src/lib/rate-limit.ts', import.meta.url)), 'utf8');

  assert.match(
    src,
    /global\.__rateLimitBuckets \?\? new Map<string, Bucket>\(\)/,
    'every hot reload starts a fresh set of empty buckets and throttles nobody'
  );
  assert.match(
    src,
    /if \(process\.env\.NODE_ENV !== 'production'\) \{\s*global\.__rateLimitBuckets = buckets;/,
    'the cached map must stay out of global in production'
  );

  // …and the gate has to be a comparison. NODE_ENV is always set by both `next
  // dev` and `next start`, so a truthy test publishes the map in production as
  // well — the half that matters.
  assert.doesNotMatch(
    src,
    /if \(process\.env\.NODE_ENV\) \{/,
    'a truthy NODE_ENV test publishes the bucket map in production as well'
  );
});
