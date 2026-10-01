import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Not one input in the app declared `autoComplete`. WCAG 2.1 SC 1.3.5
// (Identify Input Purpose) needs it, and so does every password manager: with
// the token absent Chrome and Firefox fill nothing, and 1Password and Bitwarden
// treat the field as a login prompt the user has to hand-identify. On /login
// that meant retyping an email and a password on every visit, and on the
// dashboard it meant the browser offered the account holder's own name as the
// project's name.
//
// Checked as source because `npm test` runs no server; the attributes are
// static JSX, so what is asserted is what the server would render.

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (rel: string) => readFileSync(join(root, 'src', ...rel.split('/')), 'utf8');

const register = src('app/(auth)/register/page.tsx');
const login = src('app/(auth)/login/login-form.tsx');
const projectForm = src('app/dashboard/project-form.tsx');

const FORMS: [string, string][] = [
  ['register', register],
  ['login', login],
  ['dashboard project form', projectForm],
];

/**
 * Every self-closing `<input … />` and `<textarea … />` tag in a component's
 * source. The description field is a textarea, so matching `<input>` alone
 * silently skipped it.
 */
const fields = (source: string) =>
  [...source.matchAll(/<(?:input|textarea)\b[\s\S]*?\/>/g)].map((m) => m[0]);

/** The one field carrying this `name`, or a failure naming what was found. */
const fieldNamed = (source: string, label: string, name: string): string => {
  const matches = fields(source).filter((tag) => tag.includes(`name="${name}"`));
  assert.equal(matches.length, 1, `expected one field named ${name} on ${label}, found ${matches.length}`);
  return matches[0];
};

const autoCompleteOf = (tag: string): string | null => tag.match(/autoComplete="([^"]*)"/)?.[1] ?? null;

test('every field declares what it is for', () => {
  // A field with the token missing is a field a password manager will not fill
  // and a screen reader announces with no purpose. "off" is a real token, which
  // is why it passes here and is checked per-field below.
  for (const [label, source] of FORMS) {
    const found = fields(source);
    assert.ok(found.length > 0, `no fields found on ${label} — the extraction is wrong`);
    for (const tag of found) {
      const name = tag.match(/name="([^"]*)"/)?.[1] ?? '(unnamed)';
      assert.ok(
        autoCompleteOf(tag) !== null,
        `the ${name} field on ${label} has no autoComplete, so browsers and password managers will not fill it`
      );
    }
  }
});

test('the sign-up and sign-in passwords are not the same field', () => {
  // Marking the login password `new-password` — or the register password
  // `current-password` — makes the password manager prompt to *save* a new
  // credential on every sign-in, and stops it offering to fill the one the user
  // already has. Both halves are silent: the form still works perfectly.
  assert.equal(autoCompleteOf(fieldNamed(register, 'register', 'password')), 'new-password');
  assert.equal(autoCompleteOf(fieldNamed(login, 'login', 'password')), 'current-password');
});

test('the project name is not the account holder', () => {
  // "Project Name" is a record's name, not the user's. Left unlabelled, Chrome
  // offers the signed-in account's own name for it, and the user has to notice
  // and delete it.
  assert.equal(autoCompleteOf(fieldNamed(projectForm, 'dashboard', 'name')), 'off');
  assert.equal(autoCompleteOf(fieldNamed(projectForm, 'dashboard', 'description')), 'off');
});

test("the browser's password hint is the server's, not a copy of it", () => {
  // `minLength` was the literal 8 while the server checked the exported
  // MIN_PASSWORD. The two agree today, and the file's own comment says the
  // other three limits are imported for exactly this reason. Raise
  // MIN_PASSWORD and the browser would keep advertising the old floor, so a
  // password the server refuses is only discovered after submitting.
  assert.match(
    register,
    /import\s*\{[^}]*\bMIN_PASSWORD\b[^}]*\}\s*from\s*'@\/lib\/validate'/,
    'register must import MIN_PASSWORD rather than restate its number'
  );
  assert.match(register, /minLength=\{MIN_PASSWORD\}/);
  assert.doesNotMatch(register, /minLength=\{\d/, 'a numeric minLength is a second copy of the limit');
});
