import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';

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