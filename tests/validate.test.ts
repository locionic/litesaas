import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  validateEmail,
  validateProject,
  formText,
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

test('a File part reads as an absent field, not as a crash', () => {
  // A server action accepts multipart/form-data and the request body is the
  // client's, so `email` can arrive as a file part. `.trim` does not exist on
  // File, so `formData.get('email') as string` followed by `.trim()` is a
  // TypeError — an unhandled 500 on an unauthenticated POST, out of a form
  // that looks perfectly ordinary in the source. Built for real rather than
  // asserted as text, because that is the only way to see the throw.
  const fd = new FormData();
  fd.set('email', new File(['alex@example.com'], 'email.txt'));
  fd.set('name', 'Alex Chen');
  fd.set('password', 'password123');

  assert.equal(formText(fd, 'email'), '');
  assert.equal(formText(fd, 'name'), 'Alex Chen');

  // Which is what lets the ordinary validator produce the ordinary message,
  // rather than the action dying before it ever gets that far.
  assert.equal(
    validateRegistration({
      name: formText(fd, 'name'),
      email: formText(fd, 'email'),
      password: formText(fd, 'password'),
    }),
    'All fields are required.'
  );
});

test('formText trims real strings and reads an absent key as empty', () => {
  const fd = new FormData();
  fd.set('name', '  Alex Chen  ');
  assert.equal(formText(fd, 'name'), 'Alex Chen');
  assert.equal(formText(fd, 'nope'), '');
  assert.equal(formText(new FormData(), 'nope'), '');
});

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

  // Exactly the cap, and exactly one past — the same pair the name cap gets
  // above. The domain is subtracted rather than a number written, so raising
  // MAX_EMAIL moves both ends with it.
  //
  // This used to assert MAX_EMAIL + 6, which is past every plausible reading of
  // the comparison: `>` and `>=` and "past MAX_EMAIL by anything" all reject it,
  // so nothing pinned which end the cap is on. `>=` measured fail 0 — a
  // 254-character address, the RFC 5321 maximum this constant is annotated
  // with, refused as too long while the error message says the limit is 254.
  const domain = '@e.com';
  assert.equal(
    validateRegistration({ ...ok, email: 'x'.repeat(MAX_EMAIL - domain.length) + domain }),
    null,
    'an address at the cap must pass'
  );
  assert.equal(
    validateRegistration({ ...ok, email: 'x'.repeat(MAX_EMAIL - domain.length + 1) + domain }),
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

test('the caps are numbers, not merely cap-shaped', () => {
  // Both caps tests above reference MAX_NAME, MAX_PASSWORD and
  // MAX_DESCRIPTION symbolically — on the input length *and* on the expected
  // message — so the constant cancels out and each passes at any value. They
  // establish that a cap exists and that the boundary is inclusive, which is most
  // of it. What they cannot establish is whether the number is a number.
  //
  // These three are the whole bound between an unauthenticated POST and the rows
  // it writes, and the file says why they exist: "small enough to bound a row",
  // so one request cannot write a multi-megabyte row into the bind-mounted SQLite
  // file. MAX_DESCRIPTION 2000 → 2000000 permits exactly that — a 2MB row per
  // request, each one replicated to S3 by Litestream — and neither caps test, nor
  // the messages a user is shown, nor the build notices.
  //
  // Written as literals for the same reason MIN_PASSWORD is, two tests up: that
  // one pins 8 twice by hand and a mutation to it was caught, which is how this
  // asymmetry was worth noticing in the first place.
  assert.equal(
    validateProject({ name: 'x'.repeat(101), description: null }),
    'Name must be 100 characters or fewer.',
    'a project name is 100 characters'
  );
  assert.equal(
    validateRegistration({ ...ok, password: 'x'.repeat(201) }),
    'Password must be 200 characters or fewer.',
    'a password is 200 characters'
  );
  assert.equal(
    validateProject({ name: 'ok', description: 'x'.repeat(2001) }),
    'Description must be 2000 characters or fewer.',
    'a project description is 2000 characters'
  );
});