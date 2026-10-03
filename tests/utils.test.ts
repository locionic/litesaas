import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDate } from '../src/lib/utils.ts';

// Run: npm test
//
// Two problems, and the second is the reason this file exists.
//
// 1. `formatDate` had no test at all. src/lib/utils.ts has exactly one live
//    export with a caller (`cn` is dead — see below), and every assertion
//    anywhere near it was a regex on the *call site* in dashboard/page.tsx.
//    Nothing checked what the function emits, so replacing it with
//    `date.toISOString().slice(0, 10)` or a `toLocaleDateString()` in another
//    locale passes the whole suite.
//
// 2. The format existed in TWO files. `formatDate` here, and again inside
//    local-date.tsx's effect — because LocalDate renders `serverText` verbatim
//    on the first client render (so hydration matches) and then swaps in the
//    browser's own answer. Two copies of the same options, and nothing held
//    them in step.
//
//    Drop `day: 'numeric'` from one and nothing failed: the server painted
//    "Jan 2026" for every project and then, on hydration, every row in the
//    dashboard silently changed to "Jan 15, 2026". The timezone swap is
//    invisible — it is the same length and the same shape — so the change read
//    as the component working. A change of *shape* is a visible regression in a
//    row of identical-looking cards, which is precisely why nothing else in the
//    app would notice.
//
//    Phase 15 removed the second copy rather than testing it harder:
//    local-date.tsx imports this `formatDate` now, so the assertion below
//    changed from "the two copies match" to "there is exactly one copy". The
//    failure it was written for is now unrepresentable.
//
// `cn` is the dead export in the same file: zero references in src/ or tests/.
// Deliberately not deleted here — that is a dependency-removal decision, not a
// test one.

/**
 * Pin the timezone the assertions are made in.
 *
 * `formatDate` formats in the ambient zone and this suite pins a literal
 * string, so an unset TZ on a developer laptop or a CI runner outside UTC would
 * move the answer by a day and fail a test about nothing. Node re-reads TZ for
 * subsequent Date work, so setting it here is enough.
 *
 * UTC is also the zone worth pinning: it is what the bundled container runs in
 * (Dockerfile sets TZ=UTC), so this is the answer the server actually gives.
 */
process.env.TZ = 'UTC';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('a timestamp renders as the server wrote it', () => {
  // Local noon, so the assertion is about the format rather than about which
  // side of midnight a given offset falls on.
  assert.equal(formatDate(new Date(2026, 0, 15, 12, 0, 0)), 'Jan 15, 2026');
});

test('every input the signature accepts renders the same instant', () => {
  // `Date | string | number` is the declared contract. The dashboard only ever
  // passes a Date today, so the other two are unpinned — and a rewrite that
  // reads `date.getMonth()` off the union type would type-error rather than
  // misbehave, but a rewrite that stringifies would not.
  const when = new Date(2026, 0, 15, 12, 0, 0);
  assert.equal(formatDate(when.toISOString()), 'Jan 15, 2026');
  assert.equal(formatDate(when.getTime()), 'Jan 15, 2026');
});

test('there is one date format, and it is the one the rows render', () => {
  // This assertion used to compare the two copies the comment above describes.
  // There is now one copy — local-date.tsx imports `formatDate` — so the check
  // gets stronger rather than weaker. A second `Intl.DateTimeFormat` anywhere
  // in the component tree is a bug by definition, because it is a second place
  // for the format to change; the old test could only notice after it had.
  const FORMAT = /Intl\.DateTimeFormat\(([\s\S]*?)\}\)/;

  const copies: string[] = [];
  for (const name of readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })) {
    if (!/\.(tsx?|mjs)$/.test(name)) continue;
    const file = join(root, 'src', name);
    const hits = readFileSync(file, 'utf8').match(new RegExp(FORMAT, 'g')) ?? [];
    for (const hit of hits) copies.push(name);
  }

  assert.deepEqual(
    copies,
    ['lib/utils.ts'],
    'the date format is written more than once, so the server text and the browser text can diverge: ' +
      copies.join(', ')
  );

  // Equal was never enough on its own. Gutting the options leaves one copy that
  // still matches itself and renders a bare number on every row, so the content
  // is pinned too — this is the assertion that says which fields the format is
  // made of.
  const options = FORMAT.exec(src('src/lib/utils.ts'))?.[1].replace(/\s+/g, ' ').trim() ?? '';
  assert.match(options, /'en-US'/, 'the format no longer pins a locale, so it follows the server’s own');
  for (const field of ['month', 'day', 'year']) {
    assert.match(options, new RegExp(`${field}:\\s*'`), `${field} is no longer part of the date format`);
  }
});