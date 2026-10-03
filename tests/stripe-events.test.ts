import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// tests/webhook-guard.test.ts pins the *watermark* — that every mutating arm
// carries `notStaleSql`, so a delayed delivery cannot resurrect a cancelled
// subscription. It does not pin what each event *does*, which is the half that
// decides whether money and entitlement agree. Nothing else covered it: flip the
// refund arm to `plan: 'pro'` and the whole suite stays green while refunded
// customers keep the product.
//
// Source assertions, because the route imports next/server, the Stripe SDK and
// the db and so cannot be imported under `node --test` — the same reason
// server-action-contracts.test.ts and demo.test.ts read source instead of
// calling in.
//
// Each invariant below is one that reads as over-cautious to somebody editing
// this file, which is exactly why it needs a test. Removed, each is money:
//
//   1. checkout.session.completed grants nothing unless payment_status is
//      'paid'. Pro is a one-time licence (CHECKOUT_MODE = 'payment'), and a
//      one-time Checkout session CAN complete with the money still outstanding.
//      Without the check the customer walks away from success_url with a
//      session, no charge, and full Pro.
//   2. The refund arm must exist at all. A refund does not delete the
//      subscription, so `customer.subscription.deleted` never arrives for one:
//      unhandled, the route still 200s, Stripe stops retrying, and a fully
//      refunded customer keeps Pro forever.
//   3. …and it must revoke rather than grant.
//   4. A partial refund is a courtesy, not a cancellation.
//   5. It matches on the customer id, not the subscription id. In payment mode
//      no subscription is ever created, so stripeSubscriptionId is NULL on every
//      row and matching on it would make the refund arm dead code.
//   6. An unrecognised subscription status must not mean "paid".
//   7. current_period_end reaches the row in MILLISECONDS. Stripe sends unix
//      seconds, and `new Date(1750000000)` is 20 January 1970 — so a live
//      subscription records a period that ended before the product shipped.
//   8. A revoked subscription records WHY. `plan` gates access and `status` is
//      what an operator reads; collapsing it to a flat 'active' makes a paused
//      customer indistinguishable from a paying one.
//   9. A skipped delivery says so in the 200 body. Stripe's event log is the
//      only place that appears, and without it a skipped delivery is
//      indistinguishable from one that was handled.

const route = readFileSync(
  fileURLToPath(new URL('../src/app/api/webhooks/stripe/route.ts', import.meta.url)),
  'utf8'
);

/**
 * One `case '…':` arm, up to the next case or the end of the switch.
 *
 * Slicing per arm is the point. A file-wide assertion passes if `plan: 'free'`
 * appears anywhere in the route — including in the arm that grants — so it would
 * sit here, green, while the refund arm handed Pro back to a refunded customer.
 */
const arm = (name: string): string => {
  const from = route.indexOf(`case '${name}':`);
  assert.notEqual(from, -1, `the ${name} arm is gone; this test needs revisiting`);
  const to = route.indexOf("case '", from + 1);
  return route.slice(from, to === -1 ? route.length : to);
};

/** Offset of the arm's write, so a guard can be proved to run before it. */
const write = (body: string): number => body.indexOf('.update(subscriptions)');

test('every column a revocation matches on is written somewhere in this route', () => {
  // The refund and cancellation arms are pinned above for what they DO — full
  // versus partial, live versus unknown — and neither of those is reachable.
  // Both look rows up by a provider id, and this one arm is the only place in
  // `src/` that ever writes those columns.
  //
  // So `stripeCustomerId: session.customer` renamed to anything, or dropped,
  // leaves the column NULL on every row forever. `charge.refunded` then matches
  // nothing, `shouldApply` answers 'missing', and the route 200s with
  // `{"skipped":"missing"}` — an event Stripe files as delivered and never
  // retries. A customer takes a full refund and keeps Pro permanently, with no
  // error anywhere. `customer.subscription.deleted` fails the identical way.
  //
  // Measured: dropping either capture leaves the whole suite green.
  //
  // LemonSqueezy cannot have this defect, which is the reason it is worth
  // checking for here rather than trusting symmetry: it stores no provider id
  // and resolves every arm by the checkout nonce, so the grant and the revocations
  // share one lookup key that tests/lemonsqueezy-route.test.ts already pins.
  const matched = [
    ...new Set([...route.matchAll(/eq\(subscriptions\.(\w+),/g)].map((m) => m[1])),
  ];
  // userId is the join key and is written by registration, not by any arm here.
  const revocationKeys = matched.filter((c) => c !== 'userId').sort();

  // Stated as a literal set, so adding a fourth provider id to a revocation is a
  // diff here rather than a silent pass — the loop below would then demand it be
  // captured, which is the whole point.
  assert.deepEqual(
    revocationKeys,
    ['stripeCustomerId', 'stripeSubscriptionId'],
    'the revocations now match on a column this list has not been asked about; revisit this test'
  );

  const written = new Set(
    [...route.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)].flatMap(([, body]) =>
      [...body.matchAll(/(\w+):/g)].map((m) => m[1])
    )
  );
  assert.ok(written.size > 0, 'no arm writes anything any more; this test needs revisiting');

  for (const column of revocationKeys) {
    assert.ok(
      written.has(column),
      `no arm writes ${column}, so every arm that revokes on it is a permanent no-op`
    );
  }

  // Written is not the same as populated. `stripeCustomerId: null` passes the loop
  // above and produces exactly the outcome it exists to prevent — the column is
  // NULL on every row forever, and the refund arm matches nothing. So the value
  // has to come off the session.
  const capture = arm('checkout.session.completed');
  for (const column of revocationKeys) {
    assert.match(
      capture,
      new RegExp(`${column}: typeof session\\.\\w+`),
      `${column} is not captured off the checkout session, so the column is never populated`
    );
  }
});

test('a completed checkout grants Pro only once the money is actually in', () => {
  const completed = arm('checkout.session.completed');

  assert.match(completed, /plan: 'pro'/, 'the paid path must still grant Pro');

  const guard = completed.indexOf("payment_status !== 'paid'");
  assert.notEqual(guard, -1, 'payment_status is no longer checked; see the file header');
  assert.ok(guard < write(completed), 'the paid check must run before the subscription is updated');

  // The user id comes from metadata set at checkout. A delivery without it has
  // no row to update and must be skipped, not guessed at from the customer id.
  assert.match(completed, /const userId = session\.metadata\?\.userId;/);
  assert.match(completed, /if \(!userId\) break;/);
});

test('a full refund revokes Pro, a partial one does not', () => {
  const refund = arm('charge.refunded');

  assert.match(refund, /plan: 'free'/, 'a refund must revoke Pro');
  assert.doesNotMatch(refund, /plan: 'pro'/, 'a refund must never grant Pro');

  // Partial refunds are a courtesy, not a cancellation.
  assert.match(
    refund,
    /if \(!charge\.refunded \|\| charge\.amount_refunded < charge\.amount\) break;/,
    'a partially-refunded charge must not revoke the licence'
  );

  // The subtle one: in payment mode no Subscription is ever created, so
  // stripeSubscriptionId is NULL on every row. Matching the refund on it — the
  // "consistent" column, the same one the cancellation arm uses — makes this
  // whole arm dead code and every refunded customer a Pro customer.
  assert.match(
    refund,
    /eq\(subscriptions\.stripeCustomerId, customerId\)/,
    'the refund must match on the customer id captured at checkout'
  );
  assert.doesNotMatch(
    refund,
    /eq\(subscriptions\.stripeSubscriptionId/,
    'stripeSubscriptionId is NULL under CHECKOUT_MODE=payment, so this arm would never match'
  );
});

test('an unrecognised subscription status does not mean paid', () => {
  // Only reachable after flipping CHECKOUT_MODE to 'subscription', which is a
  // one-line change — and the natural way to write it is to treat any status
  // that is not obviously dead as still-paying, which is the wrong direction
  // for money.
  const updated = arm('customer.subscription.updated');

  assert.match(
    updated,
    /const active = subscription\.status === 'active' \|\| subscription\.status === 'trialing';/,
    'live access must be an allowlist of known-good statuses, not a denylist'
  );
  assert.match(updated, /plan: active \? 'pro' : 'free'/);
});

test('every mutating arm is reachable from the switch, not just present in it', () => {
  // A `case` commented out, or one added without an arm, is invisible to a test
  // that only counts updates. The set below is the whole entitlement surface:
  // the invariants above are meaningless if an event can arrive, match
  // nothing, and the route 200s so Stripe never retries it.
  const arms = [...route.matchAll(/^ {4}case '([a-z._]+)':/gm)].map((m) => m[1]);
  assert.deepEqual(
    arms,
    [
      'checkout.session.completed',
      'customer.subscription.deleted',
      'charge.refunded',
      'customer.subscription.updated',
    ],
    `the set of entitlement-bearing Stripe events changed: ${arms.join(', ')}`
  );
});

test('the period end reaches the row in milliseconds, not Stripe\'s seconds', () => {
  // Lifted and run, because the failure is a unit and a regex cannot tell you
  // which unit it found — `current_period_end: 1750000000` appears once and
  // matches just as well either way. `new Date()` on unix SECONDS does not
  // throw or warn; it returns 20 January 1970 and writes it to the column, so a
  // live subscription is recorded as having lapsed before the product shipped
  // and nothing anywhere reports an error.
  const updated = arm('customer.subscription.updated');
  const expr = updated.match(/currentPeriodEnd: (new Date\([^)]*\)),/)?.[1];
  assert.ok(expr, 'currentPeriodEnd is no longer written from the Stripe period; this test needs revisiting');

  const periodEnd = new Function('subscription', `return ${expr};`) as (s: {
    current_period_end: number;
  }) => Date;
  const seconds = 1_750_000_000; // 14 June 2025, as Stripe would send it.

  assert.equal(
    periodEnd({ current_period_end: seconds }).getTime(),
    seconds * 1000,
    'current_period_end is unix seconds and the column holds a Date; the ×1000 is missing'
  );
  // Not a tautology: the epoch is a real, writable value, so an unconverted value
  // satisfies nothing above. This is what the mutation actually produces.
  assert.notEqual(periodEnd({ current_period_end: seconds }).getUTCFullYear(), 1970);
});

test('a revoked subscription records why it was revoked', () => {
  // `plan` is what gates access; `status` is what a human reads when a customer
  // says they cancelled. Written flat, a paused subscription and a deleted one
  // both read `status: 'active'` — correct on the entitlement line and useless
  // on the only line anyone queries when billing looks wrong.
  //
  // 'past_due' is the one that has to survive: it is the only record that a
  // customer stopped paying rather than chose to leave.
  const updated = arm('customer.subscription.updated');
  assert.match(
    updated,
    /status: active \? 'active' : subscription\.status === 'past_due' \? 'past_due' : 'canceled',/,
    'past_due must stay distinguishable from canceled — nothing else records the difference'
  );
});

test('a delivery that was skipped says so in the response', () => {
  // Stripe shows the 200 body in its event log, and this is the only place a
  // skip is visible. A route that answered `{received: true}` for a stale event
  // it deliberately ignored is indistinguishable, in the log, from one that
  // updated the row — which is the state webhook-guard.test.ts exists to create
  // and would then be unverifiable from outside.
  assert.match(
    route,
    /return NextResponse\.json\(\{ received: true, \.\.\.\(skipped \? \{ skipped \} : \{\}\) \}\);/,
    'the skip reason must reach Stripe’s event log'
  );

  // …and `skipped` is assigned. A spread over a variable nothing ever writes is
  // a spread over `undefined`: the assertion above stays green while the field
  // can never appear, which is the same trap as a guard that is present but
  // unreachable. One assignment per mutating arm, or an arm skips silently.
  const assignments = [...route.matchAll(/if \(verdict !== 'ok'\) \{ skipped = (\w+); break; \}/g)];
  assert.equal(
    assignments.length,
    4,
    `expected all 4 arms to report a skipped verdict, found ${assignments.length}`
  );
  for (const [, verdict] of assignments) {
    assert.equal(verdict, 'verdict', 'an arm records something other than the verdict');
  }
});