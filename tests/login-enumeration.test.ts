import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// tests/password-timing.test.ts proves the DUMMY_HASH equaliser works: that
// verifyPassword against it costs the same as against a real hash and returns
// false either way. That is a property of the function in src/lib/password.ts.
//
// It says nothing about the call site, which is where the oracle actually is.
// `!user || verifyPassword(password, user.passwordHash)` short-circuits on a
// missing row — no user means no KDF, so the response comes back in ~0.1ms
// instead of scrypt's ~45ms, and a stranger measures which addresses are
// registered by timing the login form. Every timing test in the repo still
// passes, because they call the lib directly and the lib was never wrong.
//
// Three more in the same function, each a one-edit silent regression:
//
//   - The throttle must be consulted before the password is verified, or it is
//     decorative: you get to grind guesses at the rate of the KDF and are only
//     throttled afterwards.
//   - The two failure returns must stay textually identical. "No account with
//     that address" alongside "Invalid email or password" hands the same oracle
//     back for free, in plain text.
//   - `if (email !== DEMO_EMAIL)` looks exactly like a vulnerability and is the
//     opposite. The demo password is published in the README, so the per-account
//     bucket lets five wrong guesses lock that account for every visitor. Closing
//     it is a denial of service on the feature the README leads with, and it
//     looks like a security fix, so nothing else would stop it.
//
// Source assertions, because the module imports next/navigation and the db and
// so cannot be imported under `node --test` — the same reason
// server-action-contracts.test.ts reads source instead of calling in. Comments
// are stripped first, so prose cannot satisfy an assertion about code.

const source = readFileSync(
  fileURLToPath(new URL('../src/app/actions/auth.ts', import.meta.url)),
  'utf8'
);

const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** loginAction's body, up to the next export. */
const loginAction = (() => {
  const from = code.indexOf('export async function loginAction(');
  assert.notEqual(from, -1, 'loginAction is gone; this test needs revisiting');
  const to = code.indexOf('\nexport ', from + 1);
  return code.slice(from, to === -1 ? code.length : to);
})();

test('the password is verified on every attempt, even with no account', () => {
  // The whole defence is that no branch reaches a response before the KDF has
  // run. So the guard has to come after the call, not before it.
  const verify = loginAction.indexOf('verifyPassword(');
  assert.notEqual(verify, -1, 'loginAction no longer verifies a password');

  const guard = loginAction.indexOf('if (!user)');
  assert.ok(guard > -1, 'the missing-account branch is gone; revisit the ordering');
  assert.ok(
    verify < guard,
    'a missing account must still be verified against a dummy hash before answering'
  );

  // Optional chaining, so reading the hash of a row that does not exist yields
  // undefined rather than throwing — and `??` so that undefined is replaced
  // rather than scrypt being handed undefined.
  assert.match(
    loginAction,
    /verifyPassword\(password, user\?\.passwordHash \?\? DUMMY_HASH\)/,
    'verify against DUMMY_HASH when there is no user row, not against undefined'
  );

  assert.doesNotMatch(
    loginAction,
    /!user \|\|/,
    'an || short-circuit skips the KDF and turns response time into an account oracle'
  );
});

test('no error message distinguishes an unknown account from a wrong password', () => {
  // Read across both the single-line and template-literal returns; the two
  // throttle messages are multi-line and a narrower pattern would miss them.
  const messages = [...loginAction.matchAll(/error:\s*(?:`([^`]*)`|'([^']*)')/g)].map(
    (m) => m[1] ?? m[2]
  );
  assert.ok(messages.length > 0, 'no error messages parsed; the scan is broken');

  // Exactly two, and identical. Three would mean a branch was added; one would
  // mean the no-account branch was folded into the wrong-password one.
  const generic = messages.filter((m) => m === 'Invalid email or password.');
  assert.equal(
    generic.length,
    2,
    `loginAction must answer "no such account" and "wrong password" identically; saw ${generic.length}`
  );

  for (const message of messages) {
    assert.doesNotMatch(
      message,
      /no account|not found|does not exist|unknown email|unregistered|already/i,
      `"${message}" reveals whether the address is registered`
    );
  }
});

test('the throttle is consulted before the password is verified', () => {
  const throttle = loginAction.indexOf('checkRateLimit(');
  const verify = loginAction.indexOf('verifyPassword(');

  assert.notEqual(throttle, -1, 'loginAction no longer rate-limits');
  assert.ok(
    throttle < verify,
    'throttling after the KDF lets an attacker spend the budget they were meant to be stopped from spending'
  );

  // Both buckets, or one of them is doing nothing. The per-IP one stops spraying
  // across accounts and the per-account one stops grinding a single one; neither
  // substitutes for the other.
  assert.ok(
    /const ipKey = `login:ip:/.test(loginAction) && /const emailKey = `login:email:/.test(loginAction),
    'login must be throttled per network and per account'
  );
});

test('the demo account is exempt from the per-account bucket on purpose', () => {
  // Looks like a vulnerability, is the opposite of one. The demo credentials are
  // published in the README, so anyone can exhaust the per-account bucket with
  // five wrong guesses and lock the account for every visitor. Nothing is being
  // protected there; the per-IP bucket still applies.
  const exempt = loginAction.indexOf('if (email !== DEMO_EMAIL)');
  assert.notEqual(exempt, -1, 'the demo exemption is gone; see the file header');

  // It must wrap the *account* bucket, not the whole function: an exemption that
  // reached the per-IP check would let a single host grind a real account.
  const bucket = loginAction.indexOf('checkRateLimit(emailKey');
  assert.ok(
    exempt < bucket && /if \(!emailCheck\.ok\)/.test(loginAction.slice(bucket)),
    'the exemption must cover the per-account bucket only'
  );
});