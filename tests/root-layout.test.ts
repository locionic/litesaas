import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `src/app/layout.tsx` is the one file every route renders through, and
// metadata.test.ts covers only its `metadata` export. Everything the layout
// itself does was unasserted: the document language, the user lookup, and the
// two nav branches it switches on. All three are one-line edits with no failing
// test, and none of them announces itself when it goes wrong.
//
// The user lookup is the interesting one. `getCurrentUser()` is what makes
// every route in the app dynamic — Next discovers it by `cookies()` throwing
// during static generation. So "cache this page" and "the nav shows the right
// thing to a signed-in user" are the same line, and an optimization that drops
// it does not error: it converts the site to static rendering and the nav starts
// offering Log In to people who are signed in. Nothing in the app would report
// that, because the signed-in routes below still resolve their own user.
//
// Source-asserted because the layout imports next/headers transitively and
// cannot be imported under `node --test` — the same reason metadata.test.ts,
// demo.test.ts and session-auth.test.ts read source instead of calling in.

const root = fileURLToPath(new URL('..', import.meta.url));
const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8');

test('the document declares its language', () => {
  // WCAG 3.1.1 Language of Page, Level A. A screen reader picks a voice and a
  // pronunciation from `lang`, and with it absent it either guesses or falls
  // back to the user's default locale — so an English page reads in whatever
  // voice the listener's OS happens to use. The text is right either way, which
  // is why this stays wrong for as long as nobody looks at it.
  //
  // Anchored on `<html`, not on `lang=` alone: the attribute means something
  // different on `<html>` (the page's language) than on an inline `<span>`
  // (a quoted passage's), and a bare search would accept either.
  assert.match(layout, /<html\b[^>]*\blang="[a-z]{2}/, 'the <html> element declares no language');
});

test('the nav is driven by the signed-in user, and the user is really resolved', () => {
  // Both halves are asserted because either one alone is satisfied by a static
  // nav: a layout that always renders Log In passes "the else branch exists", and
  // one that always renders Dashboard passes "the user branch exists". The
  // failure is the same either way and it is silent — a signed-in user is shown
  // a call to action to sign in, on every page, including the dashboard.
  const split = layout.indexOf('{user ? (');
  assert.notEqual(split, -1, 'the nav no longer branches on the user');

  const branch = layout.indexOf(') : (', split);
  assert.notEqual(branch, -1, 'the ternary has no else arm; this test needs revisiting');

  const signedIn = layout.slice(split, branch);
  const signedOut = layout.slice(branch);

  assert.match(signedIn, /href="\/dashboard"/, 'the signed-in nav does not offer the dashboard');
  assert.match(signedOut, /href="\/login"/, 'the signed-out nav does not offer sign-in');
  assert.doesNotMatch(signedIn, /href="\/login"/, 'a signed-in user is still being offered a sign-in link');

  // …and the flag is a resolved user rather than a constant. `const user = null`
  // compiles, renders, and passes every branch assertion above; this is the only
  // thing that notices. Awaited specifically: an unawaited call resolves to a
  // Promise, which is truthy, so the nav would show the signed-in shape to
  // everyone with the links inside it still pointing at the right places.
  assert.match(layout, /const user = await getCurrentUser\(\)/, 'the layout no longer resolves the current user');
});

test('every link that opens a new tab says so in its rel', () => {
  // Security, and the repo has six of them. `target="_blank"` historically gave
  // the opened page a live `window.opener` it could use to navigate the LiteSaaS
  // tab to a phishing clone — the reverse-tabnabbing trick. Every major browser
  // now implies `noopener` for `_blank`, so that hole is closed by default and
  // this is not the only thing standing between the app and it.
  //
  // What `rel="noreferrer"` adds on top is that the outbound site stops learning
  // which page you came from. That is why the requirement is stated as "declares
  // a rel" rather than "carries noopener" — an explicit attribute is what
  // survives a browser without the implicit default, and it is also the only
  // part of this that is about privacy rather than safety.
  //
  // Scanned across every route rather than listed, so a link added next month is
  // covered without anyone remembering this file.
  const files = readdirSync(join(root, 'src/app'), { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.tsx')
  );
  assert.ok(files.length > 0, 'no pages found — the scan is wrong');

  let checked = 0;
  for (const file of files) {
    const source = readFileSync(join(root, 'src/app', file), 'utf8');
    for (const tag of source.matchAll(/<a\b[\s\S]*?>/g)) {
      if (!tag[0].includes('target="_blank"')) continue;
      checked++;
      assert.match(
        tag[0],
        /rel="[^"]*\b(?:noopener|noreferrer)\b/,
        `${file}: a link opening a new tab declares no rel — it hands the destination a live opener and its own referrer`
      );
    }
  }
  assert.ok(checked >= 6, `this test found only ${checked} outbound links and is about to stop proving anything`);
});
