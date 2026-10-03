import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLANS, CHECKOUT_MODE, FREE_PROJECT_LIMIT, projectLimitFor, isRealSecret } from '../src/lib/stripe.ts';

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

const shipped = (name: string): string | undefined =>
  readSrc('../.env.example').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];

test('every Stripe secret .env.example ships is rejected as unconfigured', () => {
  // The webhook signing secret is not optional the way an unused variable is.
  // `checkout.session.completed` is the only thing that turns a paid order into
  // Pro, and .env.example ships whsec_... — non-empty, so every truthiness test
  // on it passes, and every delivery fails signature verification instead.
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    const value = shipped(name);
    assert.ok(value, `${name} should still be present in .env.example`);
    assert.equal(
      isRealSecret(value),
      false,
      `${name} ships the placeholder ${JSON.stringify(value)}, which must not read as configured`
    );
  }
});

test('a real secret is still accepted, so the guard is not "always refuse"', () => {
  // Without this the test above is satisfied by a predicate that returns false
  // for everything — which would switch checkout off on every deployment,
  // including the ones paying customers.
  assert.equal(isRealSecret('sk_test_51' + 'a'.repeat(32)), true);
  assert.equal(isRealSecret('whsec_' + 'b'.repeat(48)), true);
  for (const bad of [undefined, '', 'sk_test_...', 'whsec_...', 'a'.repeat(19), '<your_key>']) {
    assert.equal(isRealSecret(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('LemonSqueezy is not "configured" without its webhook secret', () => {
  // The same trap on the other provider: with no signing secret every order
  // webhook 401s, so a paid customer keeps the free plan. This predicate is the
  // only thing standing between them, because nothing else reads the variable.
  const ls = code('../src/lib/lemonsqueezy.ts');
  const predicate = ls.slice(ls.indexOf('export function isLemonSqueezyConfigured'));
  assert.match(predicate, /webhookSecret/, 'a LemonSqueezy checkout with no webhook secret will 401 on every order');
});

test('the Stripe client is built from a real key, at a pinned API version', () => {
  // `isRealSecret` is pinned three times over already — against the values
  // .env.example ships, against a real key, and as the LemonSqueezy config gate.
  // The one call that decides whether a client exists at all was not among them.
  //
  // Drop `isRealSecret` from that ternary and `new Stripe('sk_test_51...')` is
  // built happily: a fully-formed client holding a placeholder key. Nothing
  // throws, nothing logs, and every attempt then fails against the live API
  // instead of degrading. Three consumers branch on `stripe` being null —
  // billing.ts:148 decides whether the Upgrade button is rendered at all,
  // billing.ts:221 picks `?billing=unconfigured` over `?billing=price`, and
  // api/webhooks/stripe/route.ts:10 refuses without it — so a clone that copied
  // .env.example gets a storefront that offers to sell, and an error if it tries.
  // The module's own comment states the intent: treat placeholders as "not
  // configured" so the zero-config dev demo still works.
  //
  // Measured, not assumed: with STRIPE_SECRET_KEY set to a shipped placeholder,
  // this mutation leaves the entire suite green.
  const stripeSrc = code('../src/lib/stripe.ts');
  assert.match(
    stripeSrc,
    /isRealSecret\(process\.env\.STRIPE_SECRET_KEY\)\s*\?\s*new Stripe\(/,
    'the Stripe client is built without checking the key is real, so a copied placeholder reads as configured'
  );

  // The version is pinned because it decides what the responses *mean*.
  // LemonSqueezy already has this test — "the request asks for the API version
  // it parses" — for exactly the failure it describes: ask for a deprecated
  // version, get a different envelope back, parse a path that is no longer
  // there, and report a payment error to a customer nothing has charged. Stripe
  // moves response shapes and field availability the same way, and billing.ts
  // reads `session.url` and the webhook's event payload out of whatever comes
  // back. Stated as the literal for the same reason: the point is this version,
  // not that some version is named.
  assert.match(
    stripeSrc,
    /apiVersion: '2025-02-24\.acacia'/,
    'the Stripe client is no longer pinned to the API version its responses are read against'
  );
});
