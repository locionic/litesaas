import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../src/lib/password.ts';

// Run: npm test

test('a correct password verifies', () => {
  const hash = hashPassword('password123');
  assert.equal(verifyPassword('password123', hash), true);
});

test('a wrong password does not verify', () => {
  const hash = hashPassword('password123');
  assert.equal(verifyPassword('password124', hash), false);
  assert.equal(verifyPassword('', hash), false);
});

test('the same password hashes differently each time (unique salt)', () => {
  assert.notEqual(hashPassword('password123'), hashPassword('password123'));
});

test('malformed hashes return false instead of throwing', () => {
  const hash = hashPassword('password123');
  const [salt, key] = hash.split(':');

  // Each of these would reach crypto.timingSafeEqual with buffers of unequal
  // length, which THROWS — turning a bad row into a 500 on the login action.
  const malformed = [
    `${salt}:`, // empty key
    `${salt}:${key.slice(0, 20)}`, // truncated key
    `${salt}:zz`, // not valid hex, decodes to nothing
    `${salt}:${'ab'.repeat(40)}`, // right length of wrong bytes
    'no-colon-at-all',
    ':',
    '',
  ];

  for (const stored of malformed) {
    assert.equal(verifyPassword('password123', stored), false, `should not throw for: ${stored}`);
  }
});

test('the salt is 16 random bytes, hex-encoded', () => {
  // Directly observable, so directly asserted — no source read needed. 16 bytes is
  // the width scrypt expects to be unique per user: two accounts that chose the
  // same password with the same salt produce identical hashes, which is what makes
  // a rainbow table worth building once instead of per-account. Narrowing the salt
  // does not break a single test above — the hash still verifies, still differs per
  // call — so without this the width is free to drift.
  const salt = hashPassword('password123').split(':')[0];
  assert.match(salt, /^[0-9a-f]{32}$/, `expected 16 bytes of hex, got ${salt.length} chars`);
});

test('the password comparison is constant-time', () => {
  // Asserted against the source rather than measured: a timing test is flaky where
  // a signature check is not, and `Buffer.equals` — the natural one-word rewrite —
  // short-circuits on the first differing byte. That leaks how much of a candidate
  // password was right, one byte at a time, and nothing in the behavioural tests
  // above can see it: every wrong password still returns false.
  const src = readFileSync(fileURLToPath(new URL('../src/lib/password.ts', import.meta.url)), 'utf8');
  const from = src.indexOf('export function verifyPassword(');
  assert.notEqual(from, -1, 'verifyPassword is gone; this test needs revisiting');
  const fn = src.slice(from, src.indexOf('\n}', from));

  assert.match(fn, /crypto\.timingSafeEqual\(/, 'the digest comparison must not short-circuit');
  // And the length guard has to stay, because timingSafeEqual throws on a mismatch
  // and a throw here is a 500 on the sign-in path rather than a failed attempt.
  assert.match(fn, /stored\.length !== derivedKey\.length/, 'the length guard before timingSafeEqual is gone');
});

test('the KDF is scrypt at its defaults, not something cheaper to crack', () => {
  // Every scrypt parameter in this module is free to drift, because nothing above
  // looks at one. Both call sites read `crypto.scryptSync(password, salt, 64)`, so
  // changing the cost in *both* keeps hashPassword and verifyPassword agreeing —
  // every behavioural test still passes, the salt is still 16 bytes, the digest is
  // still compared with timingSafeEqual, and every stored hash is still correct.
  //
  // What it costs is the only thing that makes scrypt worth using here. `{ N: 4096 }`
  // is a 4x cut and `{ N: 1024 }` is 16x: an attacker holding the SQLite file gets
  // that many more guesses per second of a leaked password, forever, and no test in
  // this file notices. Dropping the key length to 32 is the same kind of drift —
  // the hex is 64 characters either way, so nothing above can see it either.
  //
  // And the timing oracle does not cover this. DUMMY_HASH is built once at import
  // at the default cost, so lowering the cost at the two sign-in call sites doesn't
  // slow it down — it just widens the gap the constant exists to close, from
  // ~45ms-vs-~0.1ms to ~45ms-vs-~3ms. The test above still passes.
  //
  // Asserted against the source rather than measured: the file's convention, and a
  // timing threshold for an absolute cost would be far noisier than the property is
  // worth. Three arguments, therefore Node's defaults — which is the value this
  // module's own comment names (~45ms at N=16384). Writing those defaults out
  // explicitly is harmless, but it is also a cost decision, so it takes editing this.
  const src = readFileSync(fileURLToPath(new URL('../src/lib/password.ts', import.meta.url)), 'utf8');
  for (const fn of ['export function hashPassword(', 'export function verifyPassword(']) {
    const from = src.indexOf(fn);
    assert.notEqual(from, -1, `${fn} is gone; this test needs revisiting`);
    const body = src.slice(from, src.indexOf('\n}', from));

    assert.match(
      body,
      /crypto\.scryptSync\([^)]*, 64\)/,
      `${fn} no longer calls scrypt(password, salt, 64) — a cost parameter moved and every stored hash just got cheaper to crack`
    );
  }
});

test('the dummy hash costs the same real KDF work as a real one', () => {
  // loginAction verifies against DUMMY_HASH when no account exists, so that an
  // unknown email spends the same ~45ms as a known one. That only works if it is a
  // genuine scrypt output at the derived key's length: a short, empty, or
  // pre-hashed placeholder is rejected by the length guard above in ~0ms, which is
  // precisely the oracle the constant was introduced to close. Asserted by shape
  // and by cost, not by reading the source.
  const [salt, key] = DUMMY_HASH.split(':');
  assert.ok(salt && key, 'DUMMY_HASH must be a salt:key pair or verifyPassword rejects it on sight');
  assert.equal(
    Buffer.from(key, 'hex').length,
    64,
    'DUMMY_HASH must hold a 64-byte key or the length guard rejects it without running the KDF'
  );

  // The cost itself, and the shape above is what makes it meaningful. scryptSync
  // at the default N=16384 is ~45ms and it runs inside `verifyPassword`, on every
  // call — not in building the constant, which happens once at import and is not
  // on the sign-in path. So what a stub has to break is the length guard: a key
  // narrower than 64 bytes is rejected at the `stored.length !== derivedKey.length`
  // line, before any scrypt runs, and a miss on an unknown email then answers in
  // ~0.1ms against ~45ms for a real one. That is the oracle, reopened by a
  // well-meaning placeholder, and it is why the width is asserted and not just
  // "does verifyPassword accept it".
  const runs = (stored: string) => {
    const t = process.hrtime.bigint();
    for (let i = 0; i < 3; i++) verifyPassword('password123', stored);
    return Number(process.hrtime.bigint() - t) / 3e6;
  };
  const real = runs(hashPassword('password123'));
  const dummy = runs(DUMMY_HASH);
  assert.ok(
    dummy > real / 3,
    `a miss on an unknown email (${dummy.toFixed(1)}ms) must cost about what a hit costs (${real.toFixed(1)}ms)`
  );
});