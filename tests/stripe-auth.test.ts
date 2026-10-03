import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// This endpoint is an unauthenticated POST that grants a paid plan. Nothing else
// in the app is a trust boundary of that shape, and the suite had no occurrence
// of `constructEvent`, `stripe-signature`, or `req.text()` in it — Stripe's
// authentication was pinned only by the fact that the file happened to contain
// the call.
//
// LemonSqueezy's equivalent is covered properly: tests/lemonsqueezy.test.ts
// checks the HMAC against real digests, and tests/lemonsqueezy-route.test.ts
// pins that the route calls it on the raw body. So the two processors are held
// to different standards, and the stricter one is the one that was easier.
//
// Four ways this regresses, each silently:
//
//   1. `await req.json()` before verifying, to read the event type early. Stripe
//      signs the raw bytes; re-serialising changes them, so every real delivery
//      400s and the endpoint looks dead in production. Nothing else fails.
//   2. A `catch` that logs and falls through. The signature is then merely
//      checked, not enforced — an unsigned POST reaches the switch and the
//      checkout arm grants Pro for free. This is the bad one.
//   3. Moving the switch above the try. Same outcome as 2, and the `event`
//      declaration would have to change with it.
//   4. Dropping either half of `if (!signature || !webhookSecret)`, so a
//      request with no signature header is constructed with `undefined` as the
//      secret. That throws, so it 400s — but for the wrong reason, and an
//      operator reading the logs sees a signature failure instead of the
//      missing header that caused it.
//
// Source assertions: the route imports next/server, the Stripe SDK and the db,
// none of which load under `node --test` — the same reason the sibling route's
// tests read source instead of calling in. Comments are stripped first, so a
// prose mention of any of these cannot satisfy an assertion about it.

const route = readFileSync(
  fileURLToPath(new URL('../src/app/api/webhooks/stripe/route.ts', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The POST handler, from its signature to end of file. */
const post = (() => {
  const from = route.indexOf('export async function POST(');
  assert.notEqual(from, -1, 'POST is gone; this test needs revisiting');
  return route.slice(from);
})();

test('the signature is checked against the raw bytes, not a re-serialised body', () => {
  // The order of these two lines is the whole claim: the body is captured as
  // text, and that same string is what gets verified.
  const body = post.indexOf('await req.text()');
  const check = post.indexOf('constructEvent(');
  assert.notEqual(body, -1, 'the raw body is no longer read');
  assert.notEqual(check, -1, 'the signature is no longer verified');
  assert.ok(body < check, 'the body must be captured before it is verified');

  // Re-parsing is the regression. It does not break the test suite, and it
  // breaks every delivery the processor makes.
  assert.doesNotMatch(
    post,
    /req\.json\(\)/,
    'parsing the body rewrites the bytes Stripe signed, so every real delivery fails'
  );

  // And the captured text is the thing passed to the verifier, not a copy of it.
  assert.match(post, /constructEvent\(body, signature, webhookSecret\)/);
});

test('an event value can only come from a verified signature', () => {
  // `let event: Stripe.Event;` with no initialiser is load-bearing. It means no
  // code path can reach the switch without a value, and the only thing that
  // produces one is a constructEvent that did not throw.
  assert.match(post, /let event: Stripe\.Event;/);
  assert.doesNotMatch(
    post,
    /let event: Stripe\.Event;[^;\n]*=/,
    'a pre-set event bypasses verification entirely'
  );

  // Exactly one assignment, and it is the verification. A second `event = …` —
  // from a JSON parse, a cast, a stub — is how the switch gets fed unverified
  // input without touching the signature block.
  const assigns = [...post.matchAll(/^\s*event = /gm)];
  assert.equal(assigns.length, 1, `event is assigned ${assigns.length} times; exactly one, and it is constructEvent`);
  const line = post.slice(assigns[0].index).split('\n')[0];
  assert.match(line, /constructEvent\(/, `the only assignment to event is not the verification: ${line}`);

  // Verification, then the catch that enforces it, then the switch that spends
  // it. In that order, so nothing can read `event` before it exists.
  const check = post.indexOf('constructEvent(');
  const caught = post.indexOf('catch (err');
  const branch = post.indexOf('switch (event.type)');
  assert.notEqual(caught, -1, 'a failed verification must not throw out of the route');
  assert.notEqual(branch, -1, 'the event switch is gone; this test needs revisiting');
  assert.ok(check < caught && caught < branch, 'verify, handle the failure, then branch on the event');
});

test('a failed verification returns before the switch, and writes nothing', () => {
  // The window between a rejected signature and the switch that grants Pro.
  // Asserting the catch exists only proves it was written; a `console.error`
  // that falls through would still contain one.
  const from = post.indexOf('catch (err');
  const to = post.indexOf('switch (event.type)');
  const window = post.slice(from, to);

  assert.ok(from < to, 'the switch must come after the catch, or there is no window to guard');
  assert.match(
    window,
    /return NextResponse\.json\(/,
    'a rejected signature must end the request — falling through grants Pro to an unsigned caller'
  );

  // Belt to the braces: no database write anywhere in the pre-verification
  // window, so an unsigned POST cannot be repaired after the fact either.
  // `includes` rather than a regex, because these are call expressions and a
  // pattern has to escape the paren to mean what it looks like.
  const prelude = post.slice(0, from);
  for (const write of ['.insert(', '.update(', '.delete(', 'shouldApply(']) {
    assert.ok(
      !prelude.includes(write),
      `${write} runs before the signature is verified`
    );
  }
});

test('a request with no signature, or an unconfigured secret, is refused up front', () => {
  const guard = post.indexOf('if (!signature || !webhookSecret)');
  const check = post.indexOf('constructEvent(');
  assert.notEqual(guard, -1, 'the missing-header guard is gone; revisit this test');
  assert.ok(guard < check, 'the guard must run before the verifier, not after');

  // Both halves, not just one: verifying with `undefined` as the secret throws,
  // which surfaces as a *signature failure* and sends an operator looking in
  // the wrong place entirely.
  assert.match(post, /!signature/, 'a request with no signature header must be refused');

  // To the `;` that ends the guard's own statement, not to the next brace: the
  // first `}` after `if (` closes the object literal in the json call, so a
  // brace-bounded slice stops before `status` and misses it.
  const block = post.slice(guard, post.indexOf(';', guard));
  assert.match(
    block,
    /return NextResponse\.json\(/,
    'the guard must end the request rather than let it continue to the verifier'
  );
  assert.match(block, /status: 4\d\d/, 'and answer with a client error');
});