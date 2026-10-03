import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// React client components, checked as source.
//
// `npm test` renders nothing, so the only place a component's contract can be
// checked is the text. The two below are both silent at build time, which is
// what makes them worth a test rather than a review habit.
//
// The build catches neither:
//
//   - Drop `'use client'` from delete-project-button.tsx and `npm run build`
//     still passes. The dashboard is dynamic — it reads the session, so Next
//     never renders it at build — so nothing ever calls the component during
//     the build. It fails at the first request instead, and the error is about
//     event handlers rather than a missing directive.
//   - Rendering a project timestamp from `new Date()` instead of `new Date(iso)`
//     compiles, hydrates and looks completely normal. Every row then shows
//     today, permanently, and the comment three lines above the effect says
//     exactly why the instant has to come from the prop.

const root = fileURLToPath(new URL('..', import.meta.url));
const appDir = join(root, 'src', 'app');

/** Every .tsx under src/app, as repo-relative paths. */
const components = (() => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) found.push(relative(root, full));
    }
  };
  walk(appDir);
  return found;
})();

/** The source of one component, by the path that `components()` yielded. */
const source = (path: string): string => readFileSync(join(root, path), 'utf8');

test('a component using hooks or an event handler is marked as a client component', () => {
  assert.ok(components.length > 0, 'no .tsx found under src/app — the walk is broken');

  // What makes a file need the directive. Hooks and event handlers are the two
  // that appear in this app; a list that quietly misses a case is worse than a
  // short one, so it is named rather than filtered by pattern.
  //
  // `useActionState` joined this list with the edit form. It is a hook like any
  // other, but the app already had three forms using it and this list did not
  // mention it, so every one of those files was being skipped here — the walk
  // found no hook in them, `needsDirective` never counted them, and dropping
  // `'use client'` from any of the four would have left this file green.
  const CLIENT_ONLY = [
    /\buseState\s*[<(]/,
    /\buseEffect\s*[<(]/,
    /\buseRouter\s*[<(]/,
    /\buseActionState\s*[<(]/,
    /\bon(?:Click|Submit|Change|Input|KeyDown)\s*=/,
  ];

  const unmarked: string[] = [];
  let needsDirective = 0;
  for (const path of components) {
    const src = source(path);
    if (!CLIENT_ONLY.some((re) => re.test(src))) continue;
    needsDirective++;
    // A directive is a string literal that has to be the FIRST statement. One
    // line further down, below an import, is not a directive at all and the file
    // is still a server component — so the anchor is the start of the file.
    if (!/^'use client';/m.test(src)) {
      unmarked.push(path);
    }
  }

  // Without this, five regexes that no longer match anything make the loop below
  // empty and `deepEqual([], [])` passes for a reason that has nothing to do
  // with the code. Every client component in this app is counted, so a pattern
  // that stops matching is a failure here rather than a silent pass below.
  assert.ok(
    needsDirective >= 6,
    `expected all six client components to need the directive, matched ${needsDirective} — one of the patterns is wrong`
  );
  assert.deepEqual(
    unmarked,
    [],
    `these use hooks or event handlers without 'use client', so they fail at the first request and not at build time:\n  ${unmarked.join('\n  ')}`
  );
});

test('a project timestamp is rendered from its instant, not from the clock', () => {
  const src = source('src/app/dashboard/local-date.tsx');

  // The effect's own dependency array names `iso`, so the component is already
  // written as if the prop mattered; only the format call does not use it. That
  // is the shape of the bug — the value flows everywhere except the one place it
  // is read, and `new Date()` is a perfectly valid date.
  //
  // Phase 15 routed this through the shared `formatDate` rather than an inline
  // Intl call, so the assertion is on the prop reaching the formatter. What it
  // cannot see is what that formatter does with it, which is why `iso` is named
  // here and `formatDate`'s own contract is pinned in utils.test.ts.
  assert.match(
    src,
    /setText\(formatDate\(iso\)\)/,
    'the timestamp must be formatted from the iso prop; `new Date()` renders today for every project'
  );
  assert.doesNotMatch(src, /formatDate\(\)/, 'the clock is not the project timestamp');
  assert.doesNotMatch(
    src,
    /Intl\.DateTimeFormat/,
    'this component formats dates itself, so it can drift from the server copy'
  );

  // …and the first render has to match the server's, or React discards it in
  // dev and the two disagree in production. `serverText` is the prop that
  // carries the server's answer, so it has to be the initial state.
  assert.match(
    src,
    /useState\(serverText\)/,
    'the first client render must be the server text verbatim, or hydration mismatches'
  );
});
