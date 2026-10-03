import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Two defects, both invisible in a screenshot and both found by reading the
// markup rather than looking at it.
//
// The dashboard is a list of N rows, and each row carried three icon controls
// named identically across every row — "Archive project", "Delete project",
// "Edit name & description". A screen reader user tabbing through gets that
// name N times with nothing to tell the rows apart; the `<h3>` holding the
// project's name sits in the row but is not associated with the buttons. The
// edit form already said `Edit ${name}`, so the pattern existed; the two icon
// buttons just never adopted it.
//
// The focus indicators: every input styled `focus:outline-none`, which in
// Tailwind 3.4 is `outline: 2px solid transparent` — a reset, not a removal.
// Each one paired it with a `focus:border-<colour>` change, which is a
// perfectly good indicator at 1x on a normal display and no indicator at all
// in Windows High Contrast, where the system overrides author colours and the
// transparent outline stays transparent. The fix uses a real `outline` rather
// than a `ring`, because a ring is `box-shadow` and forced-colors drops
// box-shadow too — the usual Tailwind a11y fix would have failed in exactly the
// mode it was added for.
//
// Checked as source: these are client components and pages that pull `next/*`
// and the database, none of which `node --test` can import. What is asserted is
// what the compiler emits, which for these properties is the string itself.

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every .tsx under src/, as [name, source]. */
const sources = (): [string, string][] => {
  const dir = join(root, 'src');
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.tsx'))
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);
};

test('no input strips its focus indicator without putting a real outline back', () => {
  // Scoped to one className string at a time rather than the file, because
  // `focus:outline-none` in one element says nothing about its neighbour — the
  // count is per line precisely so a file can have some inputs styled correctly
  // and others not.
  const stripped: { file: string; text: string }[] = [];

  for (const [name, src] of sources()) {
    src.split('\n').forEach((text, i) => {
      if (!text.includes('focus:outline-none')) return;
      stripped.push({ file: `${name}:${i + 1}`, text });

      // Width and colour, or nothing is drawn. `focus:outline-offset-2` alone
      // would satisfy a looser check, so the colour is required explicitly: a
      // width with no colour is the transparent outline, restated.
      assert.match(
        text,
        /focus:outline-[1-9]\d*/,
        `${name}:${i + 1} removes the focus outline and never sets a width`
      );
      assert.match(
        text,
        /focus:outline-(?!offset\b|outline\b|none\b)[a-z]+/,
        `${name}:${i + 1} removes the focus outline and never sets a colour, ` +
          'so it is invisible in forced-colors mode where author colours are overridden'
      );
    });
  }

  // The scan is vacuous if the app ever stops using this idiom — which is the
  // success case, not a failure, but it must be distinguishable from "the scan
  // is broken". Asserted rather than trusted, because a regex that matches
  // nothing looks exactly like a regex that stopped matching.
  assert.ok(
    stripped.length > 0,
    'no `focus:outline-none` anywhere in src/ — either the app gained proper ' +
      'focus styling or this scan stopped working; check before trusting it'
  );
});

test('every per-row control names the project it acts on', () => {
  const page = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');
  const del = readFileSync(join(root, 'src/app/dashboard/delete-project-button.tsx'), 'utf8');

  // The generic name, with the project interpolated in. Checked as literals
  // because a bare `'Delete project'` is the exact regression: it reads fine,
  // it renders fine, and it is indistinguishable from its eleven neighbours.
  for (const [label, src] of [
    ['archive', page],
    ['delete', del],
  ] as const) {
    assert.doesNotMatch(
      src,
      new RegExp(`aria-label=["']${label} project["']`),
      `the ${label} button announces the same name on every row`
    );
  }

  assert.match(
    page,
    /aria-label=\{p\.status === 'archived' \? `Restore \$\{p\.name\}` : `Archive \$\{p\.name\}`\}/,
    'the archive/restore button must say which project it acts on'
  );
  assert.match(
    del,
    /aria-label=\{`Delete \$\{name\}`\}/,
    'the delete button must say which project it acts on'
  );

  // `title` is a second, redundant source of the same name. Leaving it generic
  // is not neutral: a mouse user reads the tooltip, a screen reader user reads
  // aria-label, and the two then disagree about what the button does.
  assert.doesNotMatch(page, /title=\{p\.status === 'archived' \? 'Restore project'/);
  assert.doesNotMatch(del, /title="Delete project"/);

  // The disclosure is the third per-row control, and it was generic too.
  assert.match(page, /Edit name &amp; description for \{p\.name\}/);
});

test('the client date is formatted by the same helper the server used', () => {
  // page.tsx renders `formatDate(p.createdAt)` into `serverText`; the client
  // component then re-renders that exact string in the browser's timezone. Two
  // copies of the same Intl options means two places to change the format, and
  // the failure is not a build error — the row shows the server's date on first
  // paint and edits itself after hydration, once, silently, for every user.
  const localDate = readFileSync(join(root, 'src/app/dashboard/local-date.tsx'), 'utf8');
  const utils = readFileSync(join(root, 'src/lib/utils.ts'), 'utf8');

  assert.match(
    localDate,
    /import \{ formatDate \} from '@\/lib\/utils'/,
    'LocalDate must import the shared helper'
  );
  assert.match(localDate, /setText\(formatDate\(iso\)\)/, 'LocalDate must format through that helper');
  assert.doesNotMatch(
    localDate,
    /Intl\.DateTimeFormat/,
    'LocalDate still formats dates itself, so it can drift from the server copy'
  );

  // And the helper it now shares is the one the row actually rendered. If
  // utils.ts ever moves to a server-only module this import becomes a client
  // bundle failure, which the same reasoning that let validate.ts be imported
  // client-side does not cover.
  assert.doesNotMatch(utils, /server-only/, 'utils.ts must stay importable from a client component');
});