import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// The one piece of data that crosses the gap between "the customer clicked
// Upgrade" and "the customer is on Pro" is a string, and it crosses as a *key*.
// `upgradeToProAction` writes it under `metadata.userId`; `checkout.session.completed`
// reads it back as `session.metadata?.userId`. Nothing in the type system spans
// that gap — the two sides are a network payload apart, and the action is
// `'use server'` while the route is a Next route handler, so neither can be
// imported here.
//
// Rename one side and the shape still compiles. The order completes, Stripe
// charges the card, the webhook matches no user, and it answers 200: the event
// is indistinguishable from a handled one in the operator's event log, so the
// customer waits on ?upgraded=true and eventually charges back.
//
// So both halves are lifted out of the source and run against each other. Not
// copied — a copy proves the value this file was written with, and would keep
// passing after either side changed.

const code = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const billing = code('../src/app/actions/billing.ts');
const route = code('../src/app/api/webhooks/stripe/route.ts');

/** The object the action actually attaches to the checkout session. */
const METADATA = (() => {
  const m = billing.match(/\bmetadata:\s*(\{[^}]*\})/);
  assert.ok(m, 'the checkout session carries no metadata; the webhook resolves no user');
  // `user` is the action's signed-in user, bound by the caller below.
  return new Function('user', `return ${m[1]}`) as (u: { id: string }) => { userId?: unknown };
})();

/** How the webhook arm recovers the user id from a Stripe session. */
const READS_USER_ID = (() => {
  const r = route.match(/const userId = ([^;]+);/);
  assert.ok(r, 'the webhook no longer reads a user id off the session');
  return new Function('session', `return ${r[1]}`) as (s: unknown) => unknown;
})();

/** The arm's only arm: the `checkout.session.completed` case, up to the next one. */
const CHECKOUT_ARM = (() => {
  const from = route.indexOf("case 'checkout.session.completed'");
  assert.notEqual(from, -1, 'checkout.session.completed is gone; this test needs revisiting');
  const to = route.indexOf('case ', from + 1);
  return route.slice(from, to === -1 ? route.length : to);
})();

test('a checkout session round-trips the user back out of its metadata', () => {
  // The whole invariant, end to end: what the action writes is what the webhook
  // reads, and it is the account the order belongs to.
  const user = { id: 'usr_paid_customer' };
  assert.equal(
    READS_USER_ID({ metadata: METADATA(user) }),
    user.id,
    'the id the action writes must be the id the webhook reads back'
  );

  // And it is a *value*, not a re-derived one. The webhook must key on the id
  // the action had, so the two cannot be joined on anything else — a body that
  // carried the email, or the price, would still "work" here and still be wrong.
  assert.deepEqual(METADATA(user), { userId: user.id });
});

test('the metadata is on the session the action creates, not somewhere else', () => {
  // The round-trip above would pass against a `metadata` lifted from any object
  // literal in the file. Pin it to the create call, because that is the only
  // payload Stripe echoes back to the webhook.
  const create = billing.indexOf('stripe.checkout.sessions.create(');
  assert.notEqual(create, -1, 'the checkout session is no longer created here');
  const call = billing.slice(create, billing.indexOf('\n    });', create));
  assert.match(
    call,
    /\bmetadata:\s*\{[^}]*userId/,
    'the metadata must be inside the checkout session that Stripe will echo back'
  );
});

test('a paid order carrying no user id is dropped rather than granted to anyone', () => {
  // The consequence, and the reason the round-trip matters. No metadata is what a
  // renamed key actually looks like on the wire: the customer has paid and the
  // payload is intact, there is simply no key under the name the webhook reads.
  const paid = { payment_status: 'paid', metadata: undefined };
  assert.equal(READS_USER_ID(paid), undefined, 'no metadata must resolve to no user');

  // …and the arm's guard has to act on that. Its presence is load-bearing: drop
  // it and `shouldApply` runs against a null user id, so the arm carries on
  // rather than bailing. Its *position* is asserted too, but for a narrower
  // reason than it looks — measured, not assumed: a guard parked between the
  // reader and the write grants nobody either, because the WHERE still carries
  // `eq(subscriptions.userId, undefined)` and matches no row. So this is not
  // standing in for a money bug today. It binds the one that a later widening
  // write would open, where the id is no longer in the predicate.
  const guard = CHECKOUT_ARM.search(/if \(!userId\) break;/);
  const write = CHECKOUT_ARM.search(/\.update\(subscriptions\)/);
  assert.notEqual(write, -1, 'the checkout arm no longer grants Pro; this test needs revisiting');
  assert.ok(guard > -1, 'the checkout arm does not check for a user id before granting Pro');
  assert.ok(guard < write, 'the arm must drop a userless order before it writes a subscription');
});
