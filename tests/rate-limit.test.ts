import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  clearRateLimits();
  checkRateLimit('d', 1, 1); // 1ms window
  assert.equal(checkRateLimit('d', 1, 1).ok, false);
  // Wait out the window. The sweep is throttled to once a second, so it has
  // almost certainly NOT run for this key — the inline `resetAt <= now` check
  // in checkRateLimit is what has to release it. Lockout correctness must not
  // depend on sweep timing.
  const until = Date.now() + 15;
  while (Date.now() < until) {
    /* spin */
  }
  assert.equal(checkRateLimit('d', 1, 1).ok, true, 'bucket must be reclaimed after the window');
});
