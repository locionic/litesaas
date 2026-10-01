import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../src/lib/password.ts';

// Run: npm test
//
// scrypt at N=16384 costs ~45ms. loginAction used to short-circuit on
// `!user || verifyPassword(...)`, so an unknown email answered in ~0.1ms and a
// known one in ~45ms — a 400x latency oracle for enumerating registered
// addresses. The fix verifies against DUMMY_HASH when there is no user row, so
// both paths pay the same KDF cost.

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function timeMs(fn: () => void, runs = 5): number {
  // First call absorbs any lazy module/JIT init; the rest are steady-state.
  fn();
  return median(
    Array.from({ length: runs }, () => {
      const t0 = process.hrtime.bigint();
      fn();
      return Number(process.hrtime.bigint() - t0) / 1e6;
    })
  );
}

test('a miss costs roughly the same as a wrong password (no timing oracle)', () => {
  const real = hashPassword('password123');

  const knownUserWrongPassword = timeMs(() => verifyPassword('password124', real));
  const unknownUser = timeMs(() => verifyPassword('password123', DUMMY_HASH));

  // Generous 5x band: scrypt dominates both, so a regression to a short-circuit
  // (0.1ms vs 45ms = 450x) blows straight through this.
  const ratio = knownUserWrongPassword / unknownUser;
  assert.ok(
    ratio > 0.2 && ratio < 5,
    `miss took ${unknownUser.toFixed(1)}ms vs ${knownUserWrongPassword.toFixed(1)}ms for a real user ` +
      `(ratio ${ratio.toFixed(1)}x) — login latency would leak which emails are registered`
  );
});

test('the dummy hash never matches any password', () => {
  assert.equal(verifyPassword('', DUMMY_HASH), false);
  assert.equal(verifyPassword('password123', DUMMY_HASH), false);
  assert.equal(verifyPassword('timing-equalizer', DUMMY_HASH), false);
  // A real-format hash using the dummy's salt must still not verify.
  const sameSaltWrongKey = `${DUMMY_HASH.split(':')[0]}:${'ab'.repeat(64)}`;
  assert.equal(verifyPassword('timing-equalizer', sameSaltWrongKey), false);
});

test('the dummy hash is well-formed so it reaches the KDF instead of early-returning', () => {
  // If DUMMY_HASH were malformed, verifyPassword would bail before scryptSync
  // and the equalization would silently stop working.
  const [salt, key] = DUMMY_HASH.split(':');
  assert.ok(salt && key, 'DUMMY_HASH must contain a salt and a key');
  assert.equal(Buffer.from(key, 'hex').length, 64, 'key must be the 64 bytes scrypt produces');
});
