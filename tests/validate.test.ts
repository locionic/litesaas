import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  validateEmail,
  validateProject,
  MAX_NAME,
  MAX_EMAIL,
  MAX_PASSWORD,
  MAX_DESCRIPTION,
} from '../src/lib/validate.ts';

// Run: npm test
//
// A server action is a plain POST, so the register form's `type="email"` and
// `minLength={8}` are browser suggestions, not enforcement. Before these checks
// existed, one request could store a 200,000-character name in the users row.

const ok = { name: 'Alex Chen', email: 'alex@example.com', password: 'password123' };

test('accepts a normal signup', () => {
  assert.equal(validateRegistration(ok), null);
});

test('rejects missing fields', () => {
  assert.equal(validateRegistration({ ...ok, name: '' }), 'All fields are required.');
  assert.equal(validateRegistration({ ...ok, email: '' }), 'All fields are required.');
  assert.equal(validateRegistration({ ...ok, password: '' }), 'All fields are required.');
});

test('rejects input that could never be a real address', () => {
  // The unbounded-growth bug: each of these was storable before.
  for (const email of ['not-an-email', 'a@b', 'a b@example.com', '@example.com', 'a@', 'plainstring']) {
    assert.ok(validateEmail(email), `should reject: ${JSON.stringify(email)}`);
  }
});

test('accepts the unusual-but-real addresses a strict pattern would break on', () => {
  for (const email of [
    'a.b+tag@sub.domain.co.uk',
    'x@example.io',
    "o'brien@example.com",
    'UPPER@EXAMPLE.COM',
  ]) {
    assert.equal(validateEmail(email), null, `should accept: ${email}`);
  }
});

test('caps bound what a single request can write', () => {
  assert.equal(
    validateRegistration({ ...ok, name: 'x'.repeat(MAX_NAME + 1) }),
    `Name must be ${MAX_NAME} characters or fewer.`
  );
  assert.equal(validateRegistration({ ...ok, name: 'x'.repeat(MAX_NAME) }), null, 'the cap itself must pass');

  assert.equal(
    validateRegistration({ ...ok, email: `${'x'.repeat(MAX_EMAIL)}@e.com` }),
    'That email address is too long.'
  );

  assert.equal(
    validateRegistration({ ...ok, password: 'x'.repeat(MAX_PASSWORD + 1) }),
    `Password must be ${MAX_PASSWORD} characters or fewer.`
  );
});

test('password length rules still hold at both ends', () => {
  assert.equal(
    validateRegistration({ ...ok, password: 'short' }),
    'Password must be at least 8 characters long.'
  );
  assert.equal(validateRegistration({ ...ok, password: '12345678' }), null, 'exactly 8 must pass');
  assert.equal(
    validateRegistration({ ...ok, password: 'x'.repeat(MAX_PASSWORD) }),
    null,
    'exactly the cap must pass'
  );
});

// The dashboard form had no server-side validation at all, so one POST could
// write a multi-megabyte row into the bind-mounted SQLite file.

test('rejects an empty project name', () => {
  // Trimming is the caller's job — `text()` in projects.ts does it before
  // calling — same contract as validateRegistration.
  assert.equal(validateProject({ name: '', description: null }), 'Project name is required.');
});

test('accepts a normal project', () => {
  assert.equal(validateProject({ name: 'AI Video Repurposer', description: 'Repurposes long videos.' }), null);
  assert.equal(validateProject({ name: 'Untitled', description: null }), null, 'description is optional');
});

test('caps bound what one request can write to a project row', () => {
  assert.equal(
    validateProject({ name: 'x'.repeat(MAX_NAME + 1), description: null }),
    `Name must be ${MAX_NAME} characters or fewer.`
  );
  assert.equal(validateProject({ name: 'x'.repeat(MAX_NAME), description: null }), null, 'the cap itself must pass');

  assert.equal(
    validateProject({ name: 'ok', description: 'x'.repeat(MAX_DESCRIPTION + 1) }),
    `Description must be ${MAX_DESCRIPTION} characters or fewer.`
  );
  assert.equal(
    validateProject({ name: 'ok', description: 'x'.repeat(MAX_DESCRIPTION) }),
    null,
    'exactly the cap must pass'
  );
});