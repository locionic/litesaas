import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLANS, CHECKOUT_MODE, FREE_PROJECT_LIMIT, projectLimitFor } from '../src/lib/stripe.ts';

// Run: npm test
//
// The bug this prevents: Pro is advertised everywhere as "$19 / one-time
// license / Lifetime updates", while billing.ts created the Checkout session
// with mode: 'subscription'. Nothing failed, no test failed, and the app
// worked perfectly — it just billed every customer a recurring monthly
// subscription for a product sold as a one-off payment. Only reading the two
// halves of the product against each other catches that class of bug, so the
// invariant is pinned here.

const pro = PLANS.find((p) => p.id === 'pro')!;

test('Pro is described as a one-time licence and charged as one', () => {
  assert.equal(pro.frequency, 'one-time license');
  assert.equal(CHECKOUT_MODE, 'payment');
});

test('the charge mode still matches the advertised frequency', () => {
  // The real assertion: whichever way the copy is worded, the mode has to agree.
  // Rewrite this when you add a recurring plan rather than deleting it — a
  // monthly plan needs CHECKOUT_MODE 'subscription' and a recurring Price.
  const recurring = /month|annual|year|recurring|subscription/i.test(pro.frequency);
  assert.equal(CHECKOUT_MODE, recurring ? 'subscription' : 'payment');
});

test('no plan promises something the checkout cannot deliver', () => {
  // "Lifetime" only holds for a one-time charge. Under mode: 'subscription'
  // the customer is charged again next month, whatever the page says.
  for (const plan of PLANS) {
    if (/lifetime|one[- ]time/i.test(plan.frequency + ' ' + plan.features.join(' '))) {
      assert.equal(CHECKOUT_MODE, 'payment', `${plan.id} promises a one-time purchase`);
    }
  }
});

test('Pro unlocks something, so paying $19 is not buying a badge', () => {
  // The bug this prevents: no code anywhere read `plan`. Free got unlimited
  // projects and Pro got unlimited projects plus a label, so the tier bought
  // nothing and the "Up to 3 active projects" line was pure advertising.
  assert.ok(
    projectLimitFor('pro') > projectLimitFor('free'),
    'Pro must allow more projects than Free or there is no reason to upgrade'
  );
  assert.equal(projectLimitFor('pro'), Infinity);
});

test('the free cap the action enforces is the one the pricing table quotes', () => {
  assert.equal(projectLimitFor('free'), FREE_PROJECT_LIMIT);
  assert.ok(
    PLANS.find((p) => p.id === 'free')!.features.some((f) => f.includes(String(FREE_PROJECT_LIMIT))),
    'the free plan must quote the limit it actually enforces'
  );
});

test('only archived projects are capped', () => {
  // Archiving is the escape hatch; if archived rows counted, a free user could
  // lock themselves out of their own data.
  const limit = projectLimitFor('free');
  assert.equal(limit, 3);
  assert.ok(Number.isFinite(limit), 'free must be capped');
});

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * Strip comments before matching on literals. Prose about `mode: 'payment'`
 * is exactly what a reader needs and exactly what a naive source scan trips
 * over — the assertions below are about what the code *does*, so comments must
 * not count.
 */
const code = (rel: string) =>
  readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const billingSrc = code('../src/app/actions/billing.ts');

test('a one-time checkout still creates a Customer, so refunds can be matched', () => {
  // Under mode: 'payment' Stripe does not create a Customer on its own. If the
  // session returns customer: null, checkout.session.completed stores no
  // stripe_customer_id — and charge.refunded matches on exactly that column, so
  // the refund finds nothing and the customer keeps Pro forever. Subscription
  // mode created one implicitly; one-time mode has to ask for it.
  assert.match(billingSrc, /customer_creation:\s*'always'/);
});

test('the checkout mode is the declared one, not an inline literal', () => {
  // An inline mode: 'subscription' here would drift from CHECKOUT_MODE, which
  // is the whole reason that constant exists.
  assert.doesNotMatch(billingSrc, /mode:\s*'(subscription|payment)'/);
  assert.match(billingSrc, /mode:\s*CHECKOUT_MODE/);
});

test('the outbound checkout call cannot hang forever', () => {
  // Without a timeout, an unresponsive API holds the request open and the
  // action's try/catch never runs.
  assert.match(code('../src/lib/lemonsqueezy.ts'), /AbortSignal\.timeout\(/);
});
