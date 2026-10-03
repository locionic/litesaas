import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// The dashboard's metrics strip reads four values from the running database —
// journal_mode, busy_timeout and page_size via PRAGMA, disk size via statSync —
// and the fifth was the literal string "~0.01ms". Same font, same size, same row.
// An operator comparing their own deployment had no way to tell which four were
// measured and which one was typed, and a plausible-looking number is the kind
// that gets screenshotted into a pitch.
//
// The landing page's "0.02ms Read Latency" and "5,000+ Req/Sec" are a
// different thing: that is the product's marketing copy about the kit in
// general, and hardcoding it there is correct. The dashboard is a claim about
// *this* instance.
//
// Checked as source because `npm test` runs no server; what is asserted is what
// the server would render.

const root = fileURLToPath(new URL('..', import.meta.url));
const dashboard = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');

test('the dashboard reports a measured query time, not a typed one', () => {
  // The literal is the bug. It survives any amount of tuning elsewhere on the
  // page and never becomes true.
  assert.doesNotMatch(dashboard, /~\s*0?\.\d+\s*ms/, 'a hardcoded query time is still in the metrics strip');

  assert.match(dashboard, /const queryStart = performance\.now\(\)/);
  assert.match(dashboard, /const queryMs = performance\.now\(\) - queryStart/);

  // The timer has to bracket the query, not something else — a clock read taken
  // either side of the wrong statement times the whole render instead.
  const start = dashboard.indexOf('performance.now()');
  const end = dashboard.indexOf('const queryMs');
  const query = dashboard.indexOf('db.query.projects.findMany');
  assert.ok(start < query && query < end, 'the timer does not bracket the projects query');

  assert.match(dashboard, /Query Time: \{/);
});

test('the other four readings still come from the database', () => {
  // The measured fifth is only honest if it is not a cover for removing the
  // rest. Each of these is a live PRAGMA or statSync, not a constant.
  for (const pragma of ['journal_mode', 'busy_timeout', 'page_size', 'synchronous']) {
    assert.match(
      dashboard,
      new RegExp(`pragma\\('${pragma}'`),
      `the ${pragma} reading is gone from the metrics strip`
    );
  }
  assert.match(dashboard, /fs\.statSync\(DB_PATH\)/, 'the disk footprint is no longer measured');
});

test('a reading that could not be taken is not displayed as one', () => {
  // `the other four readings still come from the database` asserts the
  // statSync is present. It says nothing about what the card shows when the
  // stat fails — and the answer used to be `4`, a plausible number in the same
  // font as four live PRAGMA readings, on a card labelled "Disk Footprint".
  //
  // So the strip had the defect it was rebuilt to remove, in its fallback: an
  // invented figure presented exactly like the real ones, with nothing to tell
  // them apart. The test above could not see it, because the measurement *is*
  // taken on the happy path — that is the only place it looks, and nothing is
  // wrong there.
  //
  // Near-unreachable, and that is the point rather than a defence of it: the
  // same relative DB_PATH is what `new Database(DB_PATH)` opens, so the file
  // exists by the time statSync runs. Nobody ever hit this branch, which is
  // why a fabricated figure sat in it for as long as it did. What changes is
  // that the defensive path no longer invents a measurement — the next person
  // to move this read onto a different connection, or behind a permissions
  // boundary, gets an honest dash instead of a plausible lie.
  const fallback = dashboard.slice(
    dashboard.indexOf('fs.statSync(DB_PATH)'),
    dashboard.indexOf('return (')
  );

  // No constant is invented when the stat fails. `dbSizeKb = 0` is the same
  // defect wearing a smaller hat, so it is excluded explicitly.
  assert.doesNotMatch(
    fallback,
    /dbSizeKb\s*=\s*\d/,
    'a fabricated disk size is shown as a measurement next to four real ones'
  );

  // …and the value the fallback is falling back *from* is null, not a number. The
  // slice above starts at the statSync, so it never saw the initialiser: setting
  // `dbSizeKb = 0` there leaves the try path untouched, satisfies
  // `dbSizeKb === null ? '—'` nowhere, and ships a card reading "0 KB" beside four
  // live PRAGMA readings. Same lie, one character away from the code that stops it.
  assert.match(
    dashboard,
    /let dbSizeKb: number \| null = null;/,
    'the disk footprint must start unknown, so a failed stat has nothing to fabricate'
  );

  // And the card renders the absent value as absent rather than interpolating
  // null. `{dbSizeKb} KB` on a null prints " KB" — not a measurement either,
  // just a different wrong one.
  assert.match(
    dashboard,
    /dbSizeKb === null \? '—'/,
    'the card must show that the footprint is unknown rather than print an empty figure'
  );
});

test('the landing page keeps its marketing figures', () => {
  // Guarding the other side of the line, so "measure the dashboard" cannot be
  // over-applied to the pitch page, where a hardcoded latency is the point.
  const landing = readFileSync(join(root, 'src/app/page.tsx'), 'utf8');
  assert.match(landing, /0\.02ms Read Latency/);
  assert.match(landing, /5,000\+ Req\/Sec/);
});
test('the free tier reaches its cap at exactly the limit, not one past it', () => {
  // `atProjectLimit` is what disables the create button and what the form renders
  // its explanation with, so an off-by-one here is the difference between "you have
  // used your free projects" and a button that looks available. The server action
  // still refuses either way — that check is the trust boundary and does not depend
  // on this — but then the refusal arrives as an error after a click instead of as
  // a button the user was never offered, which is the half this is for.
  //
  // The comparison is lifted rather than restated: a regex for `>=` would keep
  // passing after a rewrite that spells the same boundary differently, and the
  // boundary itself is what matters here, not the operator.
  const m = dashboard.match(/const atProjectLimit = ([^;]+);/);
  assert.ok(m, 'atProjectLimit is gone; this test needs revisiting');
  const atLimit = new Function('activeCount', 'projectLimit', `return ${m[1]}`) as (
    a: number,
    l: number
  ) => boolean;

  assert.equal(atLimit(3, 3), true, 'the cap is reached at exactly the limit');
  assert.equal(atLimit(3, 4), false, 'and not reached one below it');
  assert.equal(atLimit(3, 2), true, 'and it stays reached above the limit');
  assert.equal(atLimit(0, 0), true, 'a zero-project tier is full on arrival');
});

test('the create button is gated on the limit the page computed', () => {
  // One invariant, two files. The test above computes `atProjectLimit`
  // correctly; nothing checked that anything consumes it. page.tsx counts the
  // active projects and hands a boolean down to a client component that owns the
  // only button that can act on it — so breaking the second half leaves the
  // first as dead code that still computes the right answer.
  //
  // What the user gets instead is the worst version of this failure: the button
  // stays live at the cap, they fill the form in, submit, and the refusal comes
  // back from the server *after* the click. `createProjectAction` refuses either
  // way and is the trust boundary — which is exactly why the affordance is worth
  // its own check rather than being assumed from the server's.
  const form = readFileSync(join(root, 'src/app/dashboard/project-form.tsx'), 'utf8');

  const disabled = form.match(/disabled=\{([^}]*)\}/)?.[1];
  assert.ok(disabled, 'the create button has no disabled attribute at all');

  /**
   * Stated as the truth table the expression has to satisfy, and run — because
   * asserting the identifier *appears* is satisfied by `!atProjectLimit` and by
   * `disabled={atProjectLimit}`, both of which pass every other assertion in
   * this file: the use count below is unchanged either way, and the label and
   * tooltip still branch on the flag correctly.
   *
   * Both were measured against this file as written, `fail 0` each:
   *
   *   `!atProjectLimit` — a free user with two projects cannot create anything
   *   at all. Worse, the button reads "Limit reached (3 active)" beside a
   *   padlock while being enabled, because the *label* polarity is pinned and
   *   the `disabled` polarity was not. The two halves of one control disagree.
   *
   *   `atProjectLimit` alone — the in-flight half goes with it. create() counts
   *   and then inserts, and projects.ts says so plainly: "two concurrent creates
   *   can exceed the cap by one". This attribute was the only thing stopping a
   *   double-click from being that concurrency, so dropping it hands a free user
   *   a four-project account under a three-project cap by clicking twice.
   *
   * Evaluated rather than pattern-matched so `&&`, a negation, a paren, or a
   * swapped operand all fail here instead of reading correctly.
   */
  const isDisabled = new Function(
    'atProjectLimit',
    'isPending',
    `return ${disabled};`
  ) as (atLimit: boolean, pending: boolean) => unknown;

  for (const [atLimit, pending, want] of [
    [false, false, false], // room to create, not submitting → live
    [false, true, true], // room to create, but a submit is in flight → blocked
    [true, false, true], // at the cap → blocked even when idle
    [true, true, true],
  ] as const) {
    assert.equal(
      isDisabled(atLimit, pending),
      want,
      `disabled={${disabled}} reads as ${!!isDisabled(atLimit, pending)} at atProjectLimit=${atLimit}, ` +
        `isPending=${pending}, but the create button must be ${want ? 'blocked' : 'live'} there`
    );
  }

  // …and a disabled button has to say why. `disabled` alone is the classic dead
  // end: the form cannot be used and offers no reason, which is the same
  // "nothing happened" the error banner was added to fix. Both the label and the
  // tooltip have to branch on the same flag.
  assert.match(form, /\{atProjectLimit \? `Limit reached/, 'the button does not explain the lock');
  assert.match(form, /title=\{atProjectLimit \?/, 'a locked button with no explanation');

  // Scoped to this component's own body: `atProjectLimit` is also the prop name
  // in the destructuring signature, so a bare count could be satisfied by the
  // declaration alone and would prove nothing about reaching the button.
  const uses = (form.match(/\batProjectLimit\b/g) ?? []).length;
  assert.ok(uses >= 4, `atProjectLimit appears ${uses} times — it is declared and barely read`);
});
