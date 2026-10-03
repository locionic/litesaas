import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyWebhookSignature, mapSubscriptionStatus, isProVariant } from '../src/lib/lemonsqueezy.ts';

// Run: npm test

const SECRET = 'whsec_test_fake_secret';
const BODY = JSON.stringify({
  meta: { event_name: 'order_created' },
  data: {
    attributes: { id: '1', status: 'paid', meta: { custom_data: { checkout_nonce: '7f3d1c9a' } } },
  },
});

test('accepts a signature produced over the raw body', () => {
  const sig = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY, sig, SECRET), true);
});

test('rejects a tampered body', () => {
  const sig = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY.replace('paid', 'free'), sig, SECRET), false);
});

test('a correctly signed body verifies whatever its whitespace looks like', () => {
  // The signature covers the exact bytes LemonSqueezy sent, which are not
  // necessarily the bytes `JSON.stringify` would produce. Computing the HMAC over
  // a re-serialised parse instead looks equivalent and is not: pretty-print it,
  // reorder the keys, or change a number's formatting and a genuinely signed
  // delivery is refused — a paid customer's order silently 401s and the app
  // keeps them on the free plan.
  //
  // The test above could not see this because BODY is itself canonical, so
  // re-serialising it reproduces it byte for byte. The body here is not.
  const pretty = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.notEqual(pretty, BODY, 'this body is canonical after all; the test proves nothing');

  const sig = crypto.createHmac('sha256', SECRET).update(pretty, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(pretty, sig, SECRET), true);

  // Key order is the other half. Same content, different bytes, and the HMAC
  // still has to match because it is over what arrived.
  const reordered = `{"data":${JSON.stringify(JSON.parse(BODY).data)},"meta":${JSON.stringify(JSON.parse(BODY).meta)}}`;
  const sig2 = crypto.createHmac('sha256', SECRET).update(reordered, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(reordered, sig2, SECRET), true);
});

test('the signature comparison is constant-time', () => {
  // Asserted against the source rather than measured: a timing test is flaky
  // where a signature check is not, and this is the claim the function's own
  // comment makes. `===` on two hex digests leaks how many leading characters
  // matched, which is enough to forge one byte at a time.
  const lib = readFileSync(fileURLToPath(new URL('../src/lib/lemonsqueezy.ts', import.meta.url)), 'utf8');
  const from = lib.indexOf('export function verifyWebhookSignature(');
  assert.notEqual(from, -1, 'verifyWebhookSignature is gone; this test needs revisiting');
  const fn = lib.slice(from, lib.indexOf('\n}', from));

  assert.match(fn, /crypto\.timingSafeEqual\(/, 'the digest comparison must not short-circuit');
  // And the length check stays, because timingSafeEqual throws on a mismatch —
  // a throw here is a 500 on the one route that must answer 401.
  assert.match(fn, /a\.length !== b\.length/, 'the length guard before timingSafeEqual is gone');
});

test('the config gate is four checks, and the secret is one of them', () => {
  // `isLemonSqueezyConfigured` is the only thing standing between a half-filled
  // .env and a storefront that takes money for a subscription it cannot honour.
  // Asserted against the source because `lemonsqueezy` captures process.env once
  // at module load — the object is frozen before any test here can set anything,
  // so the predicate has one answer for the whole run and cannot be exercised
  // case by case.
  //
  // Both edits below are the shape a tidy-up takes, and neither reads as a bug:
  //
  //   truthiness instead of isRealSecret  .env.example ships the four LemonSqueezy
  //     values empty today, so the two are identical — which is exactly the point.
  //     The file's own comment says the guard is held "if a placeholder is added
  //     later", and plans.test.ts:114 already pins that exact rule for Stripe's
  //     two secrets. Copy a LemonSqueezy dashboard value into .env next to a
  //     template's `whsec_...`, the gate opens, checkout starts being sold, and
  //     every delivery is signed with a key that is not the real one — so every
  //     webhook 401s and paid customers keep the free plan. The comment describes
  //     that failure as the reason the check exists, and nothing held the check.
  //
  //   variantId dropped from the conjunction  the gate then answers true with
  //     nothing to sell, so billing.ts redirects nowhere useful and the Upgrade
  //     button leads to a checkout that cannot be created.
  const lib = readFileSync(fileURLToPath(new URL('../src/lib/lemonsqueezy.ts', import.meta.url)), 'utf8');
  const from = lib.indexOf('export function isLemonSqueezyConfigured(');
  assert.notEqual(from, -1, 'isLemonSqueezyConfigured is gone; this test needs revisiting');
  const fn = lib.slice(from, lib.indexOf('\n}', from));

  assert.match(
    fn,
    /isRealSecret\(lemonsqueezy\.webhookSecret\)/,
    'the signing secret must be checked for being real, not merely non-empty'
  );
  // All four, by name: a conjunct that goes missing is invisible because the
  // remaining three still answer true on a correctly filled .env.
  for (const name of ['apiKey', 'storeId', 'variantId']) {
    assert.match(fn, new RegExp(`lemonsqueezy\\.${name}`), `the config gate no longer checks ${name}`);
  }
});

test('rejects a wrong secret, and never throws on length mismatch', () => {
  const sig = crypto.createHmac('sha256', 'other_secret').update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY, sig, SECRET), false);
  // timingSafeEqual throws on unequal lengths; the guard must swallow that.
  assert.equal(verifyWebhookSignature(BODY, 'deadbeef', SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, null, SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, sig, undefined), false);
});

test('maps LemonSqueezy statuses onto the subscriptions.status enum', () => {
  assert.deepEqual(mapSubscriptionStatus('active'), { plan: 'pro', status: 'active' });
  assert.deepEqual(mapSubscriptionStatus('on_trial'), { plan: 'pro', status: 'trialing' });
  // Terminal states must revoke, not freeze the user on a dead plan.
  assert.deepEqual(mapSubscriptionStatus('expired'), { plan: 'free', status: 'canceled' });
  assert.deepEqual(mapSubscriptionStatus('canceled'), { plan: 'free', status: 'canceled' });
});

test('only a live subscription keeps Pro', () => {
  // LS auto-pauses when a renewal payment fails. This used to fall through the
  // default arm to `plan: 'pro'`, so a user who stopped paying kept Pro
  // indefinitely — and nothing downstream reads `status`, so the damage was
  // invisible.
  assert.deepEqual(mapSubscriptionStatus('paused'), { plan: 'free', status: 'past_due' });
  assert.deepEqual(mapSubscriptionStatus('past_due'), { plan: 'free', status: 'past_due' });
  assert.deepEqual(mapSubscriptionStatus('unpaid'), { plan: 'free', status: 'past_due' });
});

test('an unrecognised status revokes rather than grants', () => {
  // Any status LemonSqueezy adds later must default to the safe direction.
  for (const s of ['', 'paused_2026', 'ACTIVE', 'on_hold']) {
    assert.equal(mapSubscriptionStatus(s).plan, 'free', `should not grant Pro for ${JSON.stringify(s)}`);
  }
});

test('only the configured variant grants or revokes', () => {
  // LS sends the id as a string in the payload and it is a number in config.
  assert.equal(isProVariant('12345', '12345'), true);
  assert.equal(isProVariant('12345', 12345), true);
  assert.equal(isProVariant(12345, '12345'), true);

  // Some other product in the same store — the $1 tip jar.
  assert.equal(isProVariant('99999', '12345'), false);
  assert.equal(isProVariant(null, '12345'), false);
  assert.equal(isProVariant(undefined, '12345'), false);

  // Unconfigured variant must match nothing, or a zero-config clone would
  // accept every order in the store.
  assert.equal(isProVariant('12345', undefined), false);
  assert.equal(isProVariant('12345', null), false);
  assert.equal(isProVariant('12345', ''), false);

  // Both sides missing, which is the case the assertions above cannot reach.
  // Each of them pairs a real id against an absent config, so all three pass
  // against a body that is just `String(actual) === String(expected)` — that
  // comparison is false whenever exactly one side is nullish, and only the
  // guard makes it false when both are. Here is the difference between
  // "reject" and `String(null) === String(null)`: every webhook event in a
  // store whose variant id was never configured clearing the variant check.
  assert.equal(isProVariant(null, null), false, 'two absent ids are not the same id');
  assert.equal(isProVariant(undefined, undefined), false);
  assert.equal(isProVariant(null, undefined), false);
  assert.equal(isProVariant(undefined, null), false);
});
