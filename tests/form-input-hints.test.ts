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

test('a field declares its purpose in `type` as well as in `autoComplete`', () => {
  // Same WCAG 1.3.5 requirement as the test above, read off a different
  // attribute. `autoComplete` says what the field is FOR; `type` says what it
  // IS, and the two have to agree.
  //
  // `type="text"` on a password field is the loud one: the field keeps its
  // name, its autoComplete, its label, its `required`, its server-side check
  // and its error banner — every one of which is asserted somewhere in this
  // file — and renders the password in plain text on the app's front door.
  // Measured: `type="text"` on login-form.tsx and on register/page.tsx each
  // left the run at 252/252.
  //
  // `type="email"` on an email field is quieter. validateEmail() rejects a
  // malformed address server-side, so nothing gets stored wrong — what is lost
  // is the browser's inline refusal and, on a phone, the `@` and `.` keys that
  // `type="email"` puts on the keyboard. It also makes true a comment in
  // server-action-contracts.test.ts which claims this file checks that the
  // markup carries it. It did not; it checked `minLength` and not this.
  //
  // Derived from the field name rather than listed, so a third form is covered
  // without anyone remembering this file — the same reason the limit test below
  // reads its expectations out of the imports. Fields not named here are
  // left alone: the project name and description carry no `type` at all, and
  // requiring one would be a formatting rule, not an input-purpose one.
  const EXPECTED: Record<string, string> = { password: 'password', email: 'email' };

  let checked = 0;
  for (const [label, source] of FORMS) {
    for (const tag of fields(source)) {
      const name = tag.match(/name="([^"]*)"/)?.[1];
      if (!name || !(name in EXPECTED)) continue;
      checked++;
      assert.match(
        tag,
        new RegExp(`type="${EXPECTED[name]}"`),
        `the ${label} ${name} field is not typed "${EXPECTED[name]}" — it says what it is for in autoComplete ` +
          `and something else in type`
      );
    }
  }
  assert.equal(checked, 4, `expected a password and an email on register and on login, checked ${checked}`);
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

test('every limit a form imports from validate is actually used', () => {
  // The test above pins one attribute. This one is derived from the imports, so
  // it covers every limit the forms claim to be sharing — and adding an import
  // tomorrow adds the requirement here for free, the same way init-db.mjs reads
  // its expectations out of its own DDL.
  //
  // It exists because the test above gives false confidence about the *shape*
  // of the fix. project-form.tsx imports MAX_NAME and MAX_DESCRIPTION with a
  // comment saying it keeps "the browser's limits and createProjectAction's
  // server-side limits from drifting apart". Delete either attribute and the
  // import is still there, the comment is still there, and the sentence is still
  // in the file asserting something false. Nothing else notices: the constant is
  // imported, so the import reads as the guarantee.
  //
  // What disappears is not a nicety. Without `maxLength` the server is the only
  // thing bounding the field, so an over-long name comes back as a rejected
  // submit — the "button that did nothing" failure the error banner on this form
  // was added to fix, arriving through the other door.
  let total = 0;
  for (const [label, source] of FORMS) {
    const clause = source.match(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/validate'/);
    if (!clause) continue; // a form with no shared limits has nothing to drift
    for (const name of clause[1].split(',').map((n) => n.trim()).filter(Boolean)) {
      total++;
      assert.match(
        source,
        new RegExp(`\\{${name}\\}`),
        `${label} imports ${name} from validate to share the server's limit, but no attribute uses it — the constant and the comment now disagree`
      );
    }
  }
  assert.ok(total >= 3, `this test found only ${total} shared limits and is about to stop proving anything`);
});
