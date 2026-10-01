import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `redirect()` in the App Router THROWS a NEXT_REDIRECT error rather than
// returning (next/dist/client/components/redirect.js). So a redirect() placed
// inside a try whose catch is a catch-all never reaches the browser — the catch
// swallows it and redirects somewhere else. On the billing path that means a
// *successful* Stripe checkout session sends the user to "?billing=error"
// instead of the checkout page, and the customer can never pay.
//
// These tests read the action as text and assert the structure, because the
// bug is invisible to unit tests: the action's happy path only misbehaves when
// a real payment provider is configured.

const ACTION = fileURLToPath(new URL('../src/app/actions/billing.ts', import.meta.url));
const src = readFileSync(ACTION, 'utf8');

/**
 * Walk every `try {` block. Throws if a redirect() appears inside one, since
 * that redirect can only ever be reached by the catch swallowing it.
 *
 * A redirect in the `catch` body is fine — that's the intended way out — so
 * `} catch {` (which both closes the try and opens the catch) ends the block.
 */
function assertNoRedirectInsideTry(source: string): Array<{ start: number; end: number }> {
  const lines = source.split('\n');
  const blocks: Array<{ start: number; end: number }> = [];
  let depth: number | null = null;
  let start = 0;

  const braces = (line: string) => (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

  lines.forEach((line, i) => {
    if (depth === null) {
      if (/\btry\s*\{/.test(line)) {
        depth = braces(line);
        start = i;
      }
      return;
    }
    if (/^\s*\}\s*(catch|finally)\b/.test(line)) {
      blocks.push({ start, end: i - 1 });
      depth = null;
      return;
    }
    if (/\bredirect\s*\(/.test(line)) {
      throw new Error(`redirect() on line ${i + 1} is inside the try opened on line ${start + 1}`);
    }
    depth += braces(line);
    if (depth <= 0) {
      blocks.push({ start, end: i });
      depth = null;
    }
  });

  return blocks;
}

test('no redirect() is reachable only through a catch-all', () => {
  const blocks = assertNoRedirectInsideTry(src);
  assert.ok(blocks.length >= 2, `expected both provider branches wrapped in try, found ${blocks.length}`);
});

test('the guard would have caught the original bug', () => {
  // Prove the scan is non-vacuous by feeding it the exact shape we removed.
  assert.throws(
    () =>
      assertNoRedirectInsideTry(`async function a() {
  try {
    const s = await api.create();
    if (s.url) {
      redirect(s.url);
    }
  } catch {
    redirect('/dashboard?billing=error');
  }
}`),
    /redirect\(\) on line 5 is inside the try opened on line 2/
  );
});

test('the success redirect happens after the try/catch, not inside it', () => {
  const successRedirect = src.indexOf('redirect(checkoutUrl)');
  const lastTryEnd = assertNoRedirectInsideTry(src).at(-1)!.end;

  assert.ok(successRedirect > lastTryEnd, 'checkoutUrl must be redirected after the last try block closes');
  assert.match(src, /checkoutUrl = await createCheckout\(/, 'LemonSqueezy must be wrapped in try (it throws)');
  assert.match(src, /checkoutUrl = session\.url/, 'Stripe session must be captured, not redirected inline');
});
