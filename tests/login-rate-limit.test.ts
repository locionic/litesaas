import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `checkRateLimit` counts every call — it has no way to know whether the
// attempt succeeded — so a bucket keeps charging for successes until the
// caller clears it (src/lib/rate-limit.ts states this contract in its own
// doc comment).
//
// loginAction checked two buckets and cleared one. Ten *successful* sign-ins
// from one network therefore locked out the eleventh with "Too many sign-in
// attempts from this network" — on shared NAT or a carrier CGNAT that is a few
// colleagues signing in, not an attacker.
//
// auth.ts is a 'use server' module and cannot be imported under `node --test`,
// so this reads it as text and checks the invariant directly: every key passed
// to checkRateLimit must also be passed to resetRateLimit. Comparing the sets
// rather than grepping for two literals is the point — it fails if a *third*
// bucket is ever added and not cleared, which a literal grep could not catch.

const ACTION = fileURLToPath(new URL('../src/app/actions/auth.ts', import.meta.url));
const src = readFileSync(ACTION, 'utf8');

const loginAction = src.slice(
  src.indexOf('export async function loginAction'),
  src.indexOf('export async function registerAction')
);

const keysChecked = new Set([...loginAction.matchAll(/checkRateLimit\(\s*(\w+)\s*,/g)].map((m) => m[1]));
const keysReset = new Set([...loginAction.matchAll(/resetRateLimit\(\s*(\w+)\s*\)/g)].map((m) => m[1]));

test('loginAction checks at least the two buckets it claims to', () => {
  // Guards the test itself: if the action is refactored so the regexes find
  // nothing, the assertions below would pass vacuously on empty sets.
  assert.deepEqual([...keysChecked].sort(), ['emailKey', 'ipKey']);
});

test('every bucket loginAction charges is cleared on success', () => {
  const uncharged = [...keysChecked].filter((k) => !keysReset.has(k));
  assert.deepEqual(uncharged, [], `success never clears: ${uncharged.join(', ')}`);
});

test('a successful sign-in leaves the caller with no throttled buckets', () => {
  // The exact bug: both clears must sit on the success path, after the password
  // check and before the session is created. A clear placed only in the failure
  // branch would satisfy the set comparison above.
  const successBranch = loginAction.indexOf('createSession(user.id)');
  assert.ok(successBranch > 0, 'expected the success path to create a session');

  const ipReset = loginAction.indexOf('resetRateLimit(ipKey)');
  assert.ok(ipReset > 0 && ipReset < successBranch, 'the IP bucket must be cleared before the session is created');
});