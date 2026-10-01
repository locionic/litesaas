import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// The landing page's calls to action were hardcoded: the hero, both pricing
// cards and the closing section all pointed at /register, and "Try Live Demo" at
// /login, whether or not anyone was signed in. A signed-in free user who
// clicked the card labelled "Upgrade to Pro" was therefore sent to the
// create-an-account form, filled it in with the address they had already
// registered, and was told "An account with this email already exists" — the
// upgrade they asked for nowhere to be found.
//
// The root layout has always swapped its own links for a Dashboard link when
// signed in, so the page body was contradicting the nav directly above it.
// Checked as source because `npm test` runs no server; what is asserted is what
// the server would render into the HTML.

const root = fileURLToPath(new URL('..', import.meta.url));
const landing = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');

test('the landing page knows whether anyone is signed in', () => {
  assert.match(landing, /const user = await getCurrentUser\(\)/);
  // Both targets are the same choice stated twice: signed in, everything goes
  // to the app; signed out, to the matching marketing page.
  assert.match(landing, /const signup = user \? '\/dashboard' : '\/register'/);
  assert.match(landing, /const tryDemo = user \? '\/dashboard' : '\/login'/);
});

test('no call to action is hardcoded to the signup form', () => {
  // The literal is the bug. It survives the moment someone adds a fifth card
  // and copies the href off the neighbouring one.
  assert.doesNotMatch(landing, /href="\/register"/);
  assert.doesNotMatch(landing, /href="\/login"/);

  const targets = [...landing.matchAll(/<Link\s+href=\{(\w+)\}/g)].map((m) => m[1]);
  assert.ok(targets.length >= 4, `expected the four calls to action, found ${targets.length}`);
  for (const target of new Set(targets)) {
    assert.ok(['signup', 'tryDemo'].includes(target), `a call to action points at bare \`${target}\``);
  }
});